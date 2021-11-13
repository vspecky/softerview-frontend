import { FunctionComponent, useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Layout, Menu, Button, Input, Space } from 'antd';
import { Redirect } from 'react-router-dom';
import 'antd/dist/antd.css';
import '../../css/home.css';

const { Header, Content } = Layout;

// <Link to={'/session'}>Go to session</Link>
//
export const Home: FunctionComponent = () => {
  const [rSession, setrSession] = useState<string>("");
  const [sessionCode, setSessionCode] = useState<string>("");
  const [sessOp, setSessOp] = useState<boolean>(false);
  const joinRef = useRef<Input>(null);

  useEffect(() => {
    if (sessionCode.length === 0 || sessOp) return;
    setSessOp(true);

    fetch(`/api/session/${sessionCode}`, {
      method: "GET",
      credentials: "include"
    }).then(res => {
      if (res.ok) setrSession(sessionCode);
      else {
        setSessionCode("");
        setSessOp(false);
      }
    });
  }, [sessionCode]);

  const createSession = () => {
    if (sessOp) return;
    setSessOp(true);
    fetch("/api/session", {
      method: "PUT",
      credentials: "include"
    }).then(res => {
      if (!res.ok) {
        throw new Error("Failed lobby creation");
      }

      return res.json();
    }).then(json => {
      setSessOp(false);
      setSessionCode(json.sessionID);
    }).catch(err => {
      setSessOp(false);
      console.log(err.message);
    });
  }

  const joinSession = () => {
    if (joinRef.current === null) return;
    const code = joinRef.current.input.value;
    if (code.length < 10) return;
    setSessionCode(code);
    joinRef.current.input.value = "";
  }

  if (rSession.length) {
    return <Redirect to={`/session/${rSession}`} />
  }

  return (
    <Layout className="global-layout">
      <Header>
        <div className="logo" />
        <Menu theme="dark" mode="horizontal" defaultSelectedKeys={[]}>
          <Menu.Item key={0}>Navbar</Menu.Item>
        </Menu>
      </Header>
      <Content className="home-content">
        <div>
          <Space direction="vertical" align="center" style={{ width: "100%" }}>
            <Input placeholder="Session code..." ref={joinRef} />
            <Button
              type="primary"
              block={true}
              onClick={joinSession}
            >
              Join Session
            </Button>
            <Button
              type="primary"
              block={true}
              onClick={createSession}
            >
              Create New Session
            </Button>
          </Space>
        </div>
      </Content>
    </Layout>
  );
}
