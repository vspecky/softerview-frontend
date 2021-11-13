import { 
  FC,
  useState,
  useRef,
  useEffect,
  createRef,
  Fragment,
  KeyboardEventHandler
} from 'react';
import { Redirect, RouteComponentProps } from 'react-router-dom';
import ResizePanel from 'react-resize-panel';
import MonacoEditor from '@monaco-editor/react';
import { editor as mEditor } from 'monaco-editor';
import Logoot from "logoot-crdt";
import { XTerm } from 'xterm-for-react';
import { Terminal } from 'xterm';
import { Input } from 'antd';
import { FitAddon } from 'xterm-addon-fit';
import useWebSocket from 'react-use-websocket';
import '../../css/main.css';
import '../../css/session.css';

// const styles = {
  // root: {
    // fontSize: 15,
    // width: "100%",
    // height: "100%",
    // fontFamily: '"Fira code", "Fira Mono", monospace',
    // ...(theme.plain as any)
  // }
// }

enum MsgTypes {
  Stdout = "STDOUT",
  Stdin = "STDIN",
}

enum TermSignals {
  SIGINT = "\x03",
}

interface IEditorChanges {
  [index: number]: any;
}

function minifyDelta(delta: any) {
  const res: any = {
    t: delta.type.slice(0, 1),
    v: delta.value,
    p: []
  }

  for (const pos of delta.position) {
    res.p.push({
      i: pos.int,
      s: pos.site,
      c: pos.clock
    });
  }

  return res;
}

type SessionProps = RouteComponentProps<{
  sessionid: string
}>;

const enc = new TextEncoder();

export const Session: FC<SessionProps> = (props: SessionProps) => {
  const [code, setCode] = useState<string>("");
  const [stdout, setStdout] = useState<string>("");
  const [ready, setReady] = useState<boolean>(false);
  const [badCode, setBadCode] = useState<boolean>(false);
  const [command, setCommand] = useState<string>("");
  const [prevEnter, setPrevEnter] = useState<number>(Date.now());
  const cmdInputRef = useRef<Input>(null);
  const logootRef = useRef(new Logoot("1"));
  const editorChanges = useRef<any[]>([]);
  const termRef = createRef<Terminal>();
  const terminalRef = useRef<XTerm>(null);

  const recvMsgHandlers: Record<string, any> = {
    [MsgTypes.Stdout]: (details: {
      output: string
    }) => {
      let newStdout = stdout + details.output;
      if (terminalRef.current !== null) {
        const encoded = enc.encode(details.output);
        terminalRef.current.terminal.write(encoded);
      }
      if (newStdout.length > 5000) {
        newStdout = newStdout.slice(newStdout.length - 5000);
      }

      setStdout(newStdout);
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

    if (terminalRef.current !== null) {
      terminalRef.current.terminal.write("interview:~$ ")
    }

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


  const handleTerminalKey = (e: KeyboardEvent): boolean => {
    if (e.key.includes("Arrow")) return false;

    // if (e.key === "c" && e.ctrlKey) return false;

    // if (e.key === "Enter") {
      // if (Date.now() - prevEnter > 1000) {
        // setPrevEnter(Date.now());
      // } else {
        // return false;
      // }
    // }


    return true
  }

  const keyHandler = (e: {
    key: string,
    domEvent: KeyboardEvent
  }) => {
    const ev = e.domEvent;
    console.log(ev);
    if (ev.key === "Enter") {
      if (terminalRef.current !== null) {
        terminalRef.current.terminal.write('\r\n');
      }
      sendMsgHandlers[MsgTypes.Stdin]({
        input: command
      });
      setCommand("");
      // if (Date.now() - prevEnter > 2000) {
        // setPrevEnter(Date.now());
        // cmdInput();
      // }
    } else if (ev.key === "c" && ev.ctrlKey) {
      setCommand("");
      sendMsgHandlers[MsgTypes.Stdin]({
        input: TermSignals.SIGINT
      });
    } else if (ev.key.length === 1) {
      if (terminalRef.current !== null) {
        setCommand(command + ev.key);
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
        <ResizePanel direction='e' style={{ flexGrow: '1' }} handleClass="resize-handler">
          <div className="dtree-container">
            <p>Directory Tree</p>
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
            <XTerm
              className="terminal"
              options={{
                rows: 20,
                rendererType: "canvas",
              }}
              onKey={keyHandler}
              customKeyEventHandler={handleTerminalKey}
              ref={terminalRef}
            />
            {/*
            <Input
              className="cmdin"
              ref={cmdInputRef}
              onPressEnter={cmdInput}
              placeholder="Enter terminal command here and press ENTER..."
            />
            */}
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
