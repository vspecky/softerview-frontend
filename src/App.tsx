// import React from 'react';
import { Home } from './components/home/Home';
import { Session } from './components/session/Session';
import { BrowserRouter as Router, Switch, Route } from 'react-router-dom';
// import logo from './logo.svg';
import './App.css';
import 'antd/dist/antd.css';
import './css/main.css';

function App() {
  return (
    <Router>
      <Switch>
        <Route exact path={'/'} component={Home} /> 
        <Route exact path={'/session/:sessionid'} component={Session} />
      </Switch>
    </Router>
  );
}

export default App;
