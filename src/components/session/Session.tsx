import { 
  FC,
  Key,
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
import MonacoEditor, { Monaco } from '@monaco-editor/react';
import { editor as mEditor } from 'monaco-editor';
import Logoot from "logoot-crdt";
import { XTerm } from 'xterm-for-react';
import { ITheme as ITerminalTheme } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import * as XtermThemes from 'xterm-theme';
import EditorThemes from './editorThemes';
import useWebSocket from 'react-use-websocket';
import { Tree, Layout, Button, Select, Typography } from 'antd';
import Draggable from 'react-draggable';
import '../../css/main.css';
import '../../css/session.css';

const { DirectoryTree } = Tree;

const fsFilterRegex = /\/tmp\/session[0-9a-z\-]+\//

enum MsgTypes {
  Stdout = "STDOUT",
  Stdin = "STDIN",
  FSChange = "FS_CHANGE",
  FSItems = "FS_ITEMS",
  SaveFile = "SAVE_FILE",
  ReqFileContents = "REQUEST_FILE_CONTENTS",
  ResFileContents = "RESPONSE_FILE_CONTENTS",
  RTCMediaReady = "RTC_MEDIA_READY",
  RTCCreateSDP = "RTC_CREATE_SDP",
  RTCOfferSDP = "RTC_OFFER_SDP",
  RTCAnswerSDP = "RTC_ANSWER_SDP",
  RTCIceCandidate = "RTC_ICE_CANDIDATE"
}

enum RTCMsgTypes {
  SameFileQuery = "SAME_FILE_QUERY",
  SameFileResponse = "SAME_FILE_RES",
  CrdtDelta = "CRDT_DELTA"
}

enum TermSignals {
  SIGINT = "\x03",
}

interface IRTCMessage {
  type: RTCMsgTypes,
  details: Record<string, any>
}

type SessionProps = RouteComponentProps<{
  sessionid: string
}>;

const cleanThemeName = (n: string) => {
  return n.toLowerCase()
    .replace(" ", "")
    .replace("(", "")
    .replace(")", "")
    .replace(" ", "")
}

const enc = new TextEncoder();
const fit = new FitAddon();

const xtermThemeNames = Object.keys(XtermThemes);
const editorThemeNames = Object.keys(EditorThemes);

export const Session: FC<SessionProps> = (props: SessionProps) => {
  const [code, setCode] = useState<string>("");
  const [ready, setReady] = useState<boolean>(false);
  const [badCode, setBadCode] = useState<boolean>(false);
  const [editorTheme, setEditorTheme] = useState<string>("vs-dark");
  const [editorThemeName, setEditorThemeName] = useState<string>("vs-dark");
  const [terminalTheme, setTerminalTheme] = useState<ITerminalTheme>(XtermThemes.Dracula);
  const [command, setCommand] = useState<string>("");
  const [backspacable, setBackspacable] = useState<number>(0);
  const [fileTree, setFileTree] = useState<IFileTreeNode[]>([]);
  const [fileOpen, setFileOpen] = useState<boolean>(false);
  const [fileEdited, setFileEdited] = useState<boolean>(false);
  const [localVideoAspectRatio, setLocalVideoAspectRatio] = useState<number>(16/9);
  const [localVideoWidth, setLocalVideoWidth] = useState<number>(350);
  const crdtDataChannel = useRef<RTCDataChannel | null>(null);
  const logootRef = useRef(new Logoot((Math.random() * 50000).toString()));
  const currentFile = useRef<string>("");
  const filesystem = useRef(new Filesystem());
  const rtcConn = useRef<RTCPeerConnection | null>(null);
  const editor = useRef<Monaco | null>(null);
  const editorChanges = useRef<any[]>([]);
  const terminalRef = useRef<XTerm>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoResizeHandle = useRef<HTMLDivElement>(null);
  const remoteVideoStream = useRef<MediaStream | null>(null);

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
      setFileTree([tree]);
    },

    [MsgTypes.ResFileContents]: (details: {
      key: string,
      contents: string
    }) => {
      if (details.key !== currentFile.current) return;
      setCode(details.contents);
      setFileOpen(true);
    },

    [MsgTypes.RTCCreateSDP]: (_: any) => {
      rtcConn.current?.createOffer().then(sdp => {
        rtcConn.current?.setLocalDescription(sdp);
        sendMsgHandlers[MsgTypes.RTCOfferSDP](JSON.stringify(sdp));
      });
    },

    [MsgTypes.RTCOfferSDP]: (details: {
      sdp: string
    }) => {
      const offerSdp = new RTCSessionDescription(JSON.parse(details.sdp));
      rtcConn.current?.setRemoteDescription(offerSdp);
      rtcConn.current?.createAnswer().then(answerSdp => {
        rtcConn.current?.setLocalDescription(answerSdp); 
        sendMsgHandlers[MsgTypes.RTCAnswerSDP](JSON.stringify(answerSdp));
      });
    },

    [MsgTypes.RTCAnswerSDP]: (details: {
      sdp: string
    }) => {
      const answerSdp = new RTCSessionDescription(JSON.parse(details.sdp));
      rtcConn.current?.setRemoteDescription(answerSdp);
    },

    [MsgTypes.RTCIceCandidate]: (details: {
      ice: string
    }) => {
      const iceCandidate = new RTCIceCandidate(JSON.parse(details.ice));
      rtcConn.current?.addIceCandidate(iceCandidate);
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
    },

    [MsgTypes.SaveFile]: () => {
      const msg = {
        type: MsgTypes.SaveFile,
        details: {
          key: currentFile,
          contents: code,
        }
      };
      wsSendMessage(JSON.stringify(msg));
      setFileEdited(false);
    },

    [MsgTypes.ReqFileContents]: (key: string) => {
      const msg = {
        type: MsgTypes.ReqFileContents,
        details: {
          key,
        },
      };
      wsSendMessage(JSON.stringify(msg));
    },

    [MsgTypes.RTCMediaReady]: () => {
      wsSendMessage(JSON.stringify({ type: MsgTypes.RTCMediaReady }));
    },

    [MsgTypes.RTCOfferSDP]: (sdp: string) => {
      wsSendMessage(JSON.stringify({
        type: MsgTypes.RTCOfferSDP,
        details: {
          sdp
        }
      }));
    },

    [MsgTypes.RTCAnswerSDP]: (sdp: string) => {
      wsSendMessage(JSON.stringify({
        type: MsgTypes.RTCAnswerSDP,
        details: {
          sdp
        }
      }));
    },

    [MsgTypes.RTCIceCandidate]: (ice: string) => {
      wsSendMessage(JSON.stringify({
        type: MsgTypes.RTCIceCandidate,
        details: {
          ice
        }
      }));
    }
  }

  const RTCSendMsgHandlers: Record<string, any> = {
    [RTCMsgTypes.SameFileQuery]: (key: string) => {
      const msg = {
        type: RTCMsgTypes.SameFileQuery,
        details: {
          key
        }
      }

      crdtDataChannel.current?.send(JSON.stringify(msg));
    },

    [RTCMsgTypes.SameFileResponse]: (isSame: boolean, key: string) => {
      const msg = {
        type: RTCMsgTypes.SameFileResponse,
        details: {
          key,
          same: isSame,
          crdt: {}
        }
      }

      if (isSame) {
        msg.details.crdt = logootRef.current.getState();
      }

      crdtDataChannel.current?.send(JSON.stringify(msg));
    },
  }

  const RTCRecvMsgHandlers: Record<string, any> = {
    [RTCMsgTypes.SameFileQuery]: (details: {
      key: string
    }) => {
      RTCSendMsgHandlers[RTCMsgTypes.SameFileResponse](details.key === currentFile.current, details.key);
    },

    [RTCMsgTypes.SameFileResponse]: (details: {
      key: string,
      same: boolean,
      crdt: any
    }) => {
      if (details.same) {
        logootRef.current.setState(details.crdt);
        setCode(logootRef.current.value());
        setFileOpen(true);
      } else {
        sendMsgHandlers[MsgTypes.ReqFileContents](details.key);
      }
    },

    [RTCMsgTypes.CrdtDelta]: (details: {
      key: string,
      delta: any
    }) => {
      if (details.key === currentFile.current) {
        logootRef.current.receive(details.delta);
        const code = logootRef.current.value();
        setCode(code);
        console.log("CODE", code);
      }
    },
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

    if (!fileEdited) {
      setFileEdited(true);
    }

    for (const change of ev.changes) {
      if (change.rangeLength === 0) {
        console.log("CHANGE", change);
        logootRef.current.insert(change.text, change.rangeOffset);
      } else {
        console.log("CHANGE", change);
        logootRef.current.replaceRange(change.text, change.rangeOffset, change.rangeLength);
      }
    }
  };

  useEffect(() => {
    // logootRef.current.on("operation", (op: any) => editorChanges.current.push(op));

    setFileTree([filesystem.current.toObject()]);

    rtcConn.current = new RTCPeerConnection();
    const dChan = rtcConn.current?.createDataChannel("crdt", {
      negotiated: true,
      id: 256
    });
    console.log("DATA CHANNEL", dChan);

    dChan.onopen = () => {
      console.log("DATA CHANNEL IS OPEN");
    }

    dChan.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data);
      console.log("RECV RTCMSG", msg);
      if (msg.type in RTCRecvMsgHandlers) {
        RTCRecvMsgHandlers[msg.type](msg.details);
      }
    };

    logootRef.current.on("operation", (op: any) => {
      console.log("SENDING", op);
      const msg = {
        type: RTCMsgTypes.CrdtDelta,
        details: {
          key: currentFile.current,
          delta: op
        }
      };

      dChan.send(JSON.stringify(msg));
    });

    crdtDataChannel.current = dChan;
      
    remoteVideoStream.current = new MediaStream();

    rtcConn.current.ontrack = e => {
      console.log("RECEIVED REMOTE TRACK");
      e.streams[0].getTracks().forEach(track => {
        remoteVideoStream.current?.addTrack(track);
      });
    };

    rtcConn.current.onicecandidate = e => {
      if (e.candidate) {
        sendMsgHandlers[MsgTypes.RTCIceCandidate](JSON.stringify(e.candidate));
      }
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
      rtcConn.current?.close();
    };
  }, []);

  useEffect(() => {
    if (remoteVideoRef.current === null) return;
    console.log("REMOTE STREAM SET");
    remoteVideoRef.current.srcObject = remoteVideoStream.current;
  }, [remoteVideoRef.current]);

  useEffect(() => {
    if (!ready) return;

    navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true
    }).then(stream => {
      sendMsgHandlers[MsgTypes.RTCMediaReady]();
      stream.getTracks().forEach(track => {
        rtcConn.current?.addTrack(track, stream);
        console.log("TRACK ADDED");
      });

      if (localVideoRef.current !== null) {
        localVideoRef.current.srcObject = stream;
        setLocalVideoAspectRatio(stream.getVideoTracks()[0].getSettings().aspectRatio as any);
      }
    });
  }, [ready]);

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

  const handleFileSelect = (selected: Key[], _: any) => {
    const key = selected[0] as string;
    if (key === currentFile.current) return;
    if (!filesystem.current.isLeaf(key)) return;

    setFileOpen(false);
    setCode("");
    currentFile.current = key;


    // sendMsgHandlers[MsgTypes.ReqFileContents](key);
    RTCSendMsgHandlers[RTCMsgTypes.SameFileQuery](key);
  };

  const handleEditorThemeSelect = (val: string, _: any) => {
    setEditorThemeName(val);
    setEditorTheme(cleanThemeName(val));
  }

  const handleTerminalThemeSelect = (val: string, _: any) => {
    setTerminalTheme(XtermThemes[val]);
    terminalRef.current?.terminal.setOption('theme', XtermThemes[val]);
  }

  const handleEditorMount = (_: any, monaco: Monaco) => {
    editor.current = monaco;
    editorThemeNames.forEach(name => {
      if (name === "vs-dark") return;
      const themeName = cleanThemeName(name);
      console.log("SET THEME", themeName);
      editor.current?.editor.defineTheme(themeName, EditorThemes[name] as any);
    });
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
          handleClass="resize-handler"
          style={{
            flexGrow: '1',
            backgroundColor: EditorThemes[editorThemeName]["colors"]["editor.foreground"]
          }}
        >
          <div
            className="dtree-container"
            style={{
              backgroundColor: EditorThemes[editorThemeName]["colors"]["editor.background"]
            }}
          >
            <DirectoryTree
              multiple
              onSelect={handleFileSelect}
              treeData={fileTree}
              style={{
                backgroundColor: EditorThemes[editorThemeName]["colors"]["editor.background"],
                color: EditorThemes[editorThemeName]["colors"]["editor.foreground"]
              }}
            />
          </div>
        </ResizePanel>
        <div className="editor-container">
          <Layout style={{ width: "100%", height: "100%" }}>
            {
              fileOpen &&
              <Layout.Header
                className="topbar"
                style={{
                  backgroundColor: EditorThemes[editorThemeName]["colors"]["editor.background"]
                }}
              >
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    marginLeft: 30
                  }}
                >
                  <Button
                    type="primary"
                    onClick={sendMsgHandlers[MsgTypes.SaveFile]}
                    disabled={!fileEdited}
                  >
                    {fileEdited ? "Save File" : "File Saved"}
                  </Button>
                </div>
                <div style={{ marginLeft: 30 }}>
                  <Typography.Text
                    style={{
                      color: EditorThemes[editorThemeName]["colors"]["editor.foreground"],
                      marginRight: 10
                    }}
                  >
                    Editor Theme:
                  </Typography.Text>
                  <Select
                    showSearch
                    placeholder="Select editor theme..."
                    defaultValue="vs-dark"
                    onSelect={handleEditorThemeSelect}
                    className="theme-select"
                  >
                    {
                      editorThemeNames.map(name => (
                        <Select.Option value={name} key={name}>{name}</Select.Option>
                      ))
                    }
                  </Select>
                </div>
                <div style={{ marginLeft: 30 }}>
                  <Typography.Text
                    style={{
                      color: EditorThemes[editorThemeName]["colors"]["editor.foreground"],
                      marginRight: 10
                    }}
                  >
                    Terminal Theme:
                  </Typography.Text>
                  <Select
                    showSearch
                    placeholder="Select terminal theme..."
                    defaultValue="Dracula"
                    onSelect={handleTerminalThemeSelect}
                    className="theme-select"
                  >
                    {
                      xtermThemeNames.map(name => (
                        <Select.Option value={name} key={name}>{name}</Select.Option>
                      ))
                    }
                  </Select>
                </div>
              </Layout.Header>
            }
            <Layout.Content style={{ backgroundColor: "#1e1e1e" }}>
              {
                fileOpen &&
                <MonacoEditor
                  height="100%"
                  width="100%"
                  defaultLanguage="javascript"
                  onChange={updateEditor}
                  onMount={handleEditorMount}
                  value={code}
                  theme={editorTheme}
                  className="editor"
                />
              }

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
                      theme: terminalTheme,
                    }}
                    onKey={keyHandler}
                    addons={[fit]}
                    customKeyEventHandler={handleTerminalKey}
                    ref={terminalRef}
                  />
                </ResizePanel>
              </div>
            </Layout.Content>
          </Layout>
        </div>
      </div>
      <Draggable bounds="parent">
        <div className="video-container local-video">
          <video
            ref={localVideoRef}
            style={{
              width: "100%",
              height: "100%",
            }}
            muted
            autoPlay
          />
        </div>
      </Draggable>
      <Draggable bounds="parent">
        <div className="video-container remote-video">
          <video
            ref={remoteVideoRef}
            style={{
              width: "100%",
              height: "100%",
            }}
            autoPlay
          />
        </div>
      </Draggable>
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
