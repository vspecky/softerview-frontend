import { 
  FunctionComponent,
  useState,
  useRef,
  useEffect,
  Fragment
} from 'react';
import ResizePanel from 'react-resize-panel';
import Editor from 'react-simple-code-editor';
import MonacoEditor from '@monaco-editor/react';
import { editor as mEditor } from 'monaco-editor';
import Logoot from "logoot-crdt";
// import { highlight, languages } from 'prismjs/components/prism-core';
import Highlight, { defaultProps } from 'prism-react-renderer';
import { XTerm } from 'xterm-for-react';
import { FitAddon } from 'xterm-addon-fit';
import LocalEchoController from 'local-echo';
import { Atom as TerminalTheme } from 'xterm-theme';
import theme from 'prism-react-renderer/themes/dracula';
// import 'prismjs/components/prism-clike';
// import 'prismjs/components/prism-javascript';
import '../../css/main.css';
import '../../css/session.css';

const styles = {
  root: {
    fontSize: 15,
    width: "100%",
    height: "100%",
    fontFamily: '"Fira code", "Fira Mono", monospace',
    ...(theme.plain as any)
  }
}

const fit = new FitAddon();
const terminalAddons = [
  new FitAddon(),
  // new LocalEchoController()
];
const initTermText = [
  "Welcome to the Session!\r\n",
  "\r\n",
  "session@dockerhost:~$ "
];

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

export const Session: FunctionComponent = () => {
  const [code, setCode] = useState<string>("");
  const terminalRef = useRef<XTerm>(null);
  const logootRef = useRef(new Logoot("1"));
  const editorChanges = useRef<any[]>([]);

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
    if (terminalRef.current !== null) {
      // for (let i = 0; i < 100; i++) {
        // terminalRef.current.terminal.writeln(`Hello there ${i}`);
      // }
      for (const line of initTermText) {
        terminalRef.current.terminal.write(line);
      }
    }

    logootRef.current.on("operation", (op: any) => editorChanges.current.push(op));

    const editorUpdateInterval = setInterval(() => {
      if (editorChanges.current.length === 0) return;

      const batch = editorChanges.current.splice(0).map(minifyDelta);
      console.log("BATCH", batch);
      const stringified = JSON.stringify(batch);
      console.log("STRINGIFIED", stringified);
      console.log("SIZE", stringified.length);
    }, 2500);

    // (async () => {
      // while (true) {
        // await terminalAddons[1].read("~$ ");
      // }
    // })()

    return () => {
      clearInterval(editorUpdateInterval);
    };
  }, []);


  const highlightCode = (code: string) => {
    return (
      <Highlight {...defaultProps} theme={theme} code={code} language="go">
        {({ tokens, getLineProps, getTokenProps }) => (
          <Fragment>
            {tokens.map((line, i) => (
              <div {...getLineProps({ line, key: i })}>
                {line.map((token, key) => <span {...getTokenProps({ token, key })} />)}
              </div>
            ))}
          </Fragment>
        )}
      </Highlight>
    );
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
        {/*
          <Editor
            value={code}
            onValueChange={setCode}
            highlight={highlightCode}
            padding={20}
            tabSize={4}
            style={styles.root}
          />
        */}

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
              <ResizePanel direction='n' style={{ flexGrow: '1' }} handleClass="resize-handler-horizontal">
                <XTerm
                  className="terminal"
                  options={{
                    rows: 10,
                    rendererType: "dom",
                    theme: TerminalTheme
                  }}
                  addons={terminalAddons}
                  ref={terminalRef}
                />
              </ResizePanel>
            </div>
        </div>
      </div>
    </div>
  );
};
