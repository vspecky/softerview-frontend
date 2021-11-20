import { 
  FC,
  useState,
  useRef,
  useEffect,
} from 'react';
import {
  minifyDelta,
  Filesystem,
  IFileTreeNode,
} from './utils';
import { Redirect, RouteComponentProps } from 'react-router-dom';
import ResizePanel from 'react-resize-panel';
import MonacoEditor from '@monaco-editor/react';
import { editor as mEditor } from 'monaco-editor';
import Logoot from "logoot-crdt";
import { XTerm } from 'xterm-for-react';
import { FitAddon } from 'xterm-addon-fit';
import { Dracula } from 'xterm-theme';
import useWebSocket from 'react-use-websocket';
import { Tree } from 'antd';
import '../../css/main.css';
import '../../css/session.css';

const { DirectoryTree } = Tree;

const fsFilterRegex = /\/tmp\/session[0-9a-z\-]+\//

enum MsgTypes {
  Stdout = "STDOUT",
  Stdin = "STDIN",
  FSChange = "FS_CHANGE",
}

enum TermSignals {
  SIGINT = "\x03",
}

interface IEditorChanges {
  [index: number]: any;
}

type SessionProps = RouteComponentProps<{
  sessionid: string
}>;

const enc = new TextEncoder();
const fit = new FitAddon();

export const Session: FC<SessionProps> = (props: SessionProps) => {
  const [code, setCode] = useState<string>("");
  const [ready, setReady] = useState<boolean>(false);
  const [badCode, setBadCode] = useState<boolean>(false);
  const [command, setCommand] = useState<string>("");
  const [backspacable, setBackspacable] = useState<number>(0);
  const [fileTree, setFileTree] = useState<IFileTreeNode[]>([]);
  const logootRef = useRef(new Logoot("1"));
  const filesystem = useRef(new Filesystem());
  const editorChanges = useRef<any[]>([]);
  const terminalRef = useRef<XTerm>(null);

  const recvMsgHandlers: Record<string, (details: any) => void> = {
    [MsgTypes.Stdout]: (details: {
      output: string
    }) => {
      if (terminalRef.current !== null) {
        const encoded = enc.encode(details.output);
        terminalRef.current.terminal.write(encoded);
        if (backspacable > 0) {
          setBackspacable(0);
        }
      }
    },

    [MsgTypes.FSChange]: (details: {
      type: string,
      oldPath: string,
      newPath: string,
      isLeaf: boolean
    }) => {
      details.oldPath = details.oldPath.replace(fsFilterRegex, "");
      details.newPath = details.newPath.replace(fsFilterRegex, "");
      filesystem.current.handle(details);
      const tree = filesystem.current.toObject();
      setFileTree(tree);
    },
  }

  const sendMsgHandlers: Record<string, any> = {
    [MsgTypes.Stdin]: (details: {
      input: string
    }) => {
      console.log("Command: ", details.input);
      const msg = {
        type: MsgTypes.Stdin,
        details: details
      }

      wsSendMessage(JSON.stringify(msg));
      setCommand("");
    }
  }

  const sessionCode = props.match.params.sessionid;
  const {
    sendMessage: wsSendMessage
  } = useWebSocket(`ws://localhost:5000/api/session/${sessionCode}/ws`, {
    fromSocketIO: false,

    onMessage: e => {
      const msg = JSON.parse(e.data);
      console.log("Websocket message: ", msg);
      if (msg.type in recvMsgHandlers) {
        recvMsgHandlers[msg.type](msg.details);
      }
    }
  }, ready);

  const updateEditor = (newVal: string | undefined, ev: mEditor.IModelContentChangedEvent) => {
    if (newVal !== undefined) {
      setCode(newVal);
    }

    console.log("CHANGESIZE", JSON.stringify(ev.changes).length);
    for (const change of ev.changes) {
      console.log("CHANGE", change);
      if (change.rangeLength === 0) {
        logootRef.current.insert(change.text, change.rangeOffset);
      } else {
        logootRef.current.replaceRange(change.text, change.rangeOffset, change.rangeLength);
      }
    }
  };

  useEffect(() => {
    logootRef.current.on("operation", (op: any) => editorChanges.current.push(op));


    const editorUpdateInterval = setInterval(() => {
      if (editorChanges.current.length === 0) return;

      const batch = editorChanges.current.splice(0).map(minifyDelta);
      console.log("BATCH", batch);
      const stringified = JSON.stringify(batch);
      console.log("STRINGIFIED", stringified);
      console.log("SIZE", stringified.length);
    }, 2500);

    const code = props.match.params.sessionid;
    fetch(`/api/session/${code}`, {
      method: "GET",
      credentials: "include"
    }).then(res => {
      if (!res.ok) setBadCode(true);
      else setReady(true);
    });

    return () => {
      clearInterval(editorUpdateInterval);
    };
  }, []);

  useEffect(() => {
    if (terminalRef.current !== null) {
      fit.fit();
      terminalRef.current.terminal.write("interview:~$ ")
      if (terminalRef.current.terminalRef.current !== null) {
        new ResizeObserver(() => {
          fit.fit();
        }).observe(terminalRef.current.terminalRef.current); 
      }
    }
  }, [terminalRef.current]);


  const handleTerminalKey = (e: KeyboardEvent): boolean => {
    return !e.key.includes("Arrow")
  }

  const keyHandler = (e: {
    key: string,
    domEvent: KeyboardEvent
  }) => {
    const ev = e.domEvent;
    if (ev.key === "Enter") {
      if (terminalRef.current !== null) {
        terminalRef.current.terminal.write('\r\n');
        if (command.length > 0 && command[command.length - 1] === "\\") {
          setCommand(command.slice(0, command.length - 1));
          setBackspacable(0);
          terminalRef.current.terminal.write("> ");
          return;
        }
      }

      sendMsgHandlers[MsgTypes.Stdin]({
        input: command
      });
      setCommand("");
    } else if (ev.key === "c" && ev.ctrlKey) {
      setCommand("");
      sendMsgHandlers[MsgTypes.Stdin]({
        input: TermSignals.SIGINT
      });
    } else if (e.key.charCodeAt(0) === 127) {
      if (terminalRef.current !== null && backspacable > 0) {
        setCommand(command.slice(0, command.length - 1));
        setBackspacable(backspacable - 1);
        terminalRef.current.terminal.write("\b \b");
      }
    } else if (ev.key.length === 1) {
      if (terminalRef.current !== null) {
        setCommand(command + ev.key);
        setBackspacable(backspacable + 1);
        terminalRef.current.terminal.write(ev.key);
      }
    }
  }

  if (badCode) {
    return <Redirect to="/" />
  }

  if (!ready) {
    return <></>
  }

  return (
    <div className='container'>
      <div className="workspace-container">
        <ResizePanel
          direction='e'
          style={{ flexGrow: '1' }}
          handleClass="resize-handler"
        >
          <div className="dtree-container">
            <p>Directory Tree</p>
            <DirectoryTree
              multiple
              treeData={fileTree}
            />
          </div>
        </ResizePanel>
        <div className="editor-container">
          <MonacoEditor
            height="100%"
            width="100%"
            defaultLanguage="javascript"
            onChange={updateEditor}
            value={code}
            theme="vs-dark"
            options={{ automaticLayout: true }}
            className="editor"
          />

          <div className="terminal-container">
            <ResizePanel
              direction='n'
              className="terminal-resizer"
              style={{ flexGrow: '1' }}
              handleClass="resize-handler-horizontal"
            >
              <XTerm
                className="terminal"
                options={{
                  rows: 10,
                  rendererType: "canvas",
                  theme: Dracula,
                }}
                onKey={keyHandler}
                addons={[fit]}
                customKeyEventHandler={handleTerminalKey}
                ref={terminalRef}
              />
            </ResizePanel>
          </div>
        </div>
      </div>
    </div>
  );
};

/*
            <ResizePanel direction='n' style={{ flexGrow: '1' }} handleClass="resize-handler-horizontal">
                <div
                  contentEditable={true}
                  onCut={noop}
                  onCopy={noop}
                  onPaste={noop}
                  className="stdout"
                >
                  {stdout}
                </div>
 
                <XTerm
                  className="terminal"
                  options={{
                    rows: 10,
                    rendererType: "dom",
                    theme: TerminalTheme
                  }}
                  ref={terminalRef}
                  onData={userTyped}
                />
*/
