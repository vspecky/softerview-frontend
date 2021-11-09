import React from 'react';
import { Link } from 'react-router-dom';

export const Home: React.FunctionComponent = () => {
  return (
    <Link to={'/session'}>Go to session</Link>
  );
}
