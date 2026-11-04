import React, { useState } from 'react';
import { apiFetch } from '../api';
import { useNavigate } from 'react-router-dom';

export const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      navigate('/');
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '2rem auto' }}>
      <h2>Login</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={submit}>
        <div>
          <label>Username:</label>
          <input value={username} onChange={e => setUsername(e.target.value)} required />
        </div>
        <div style={{ marginTop: 8 }}>
          <label>Password:</label>
          <input type='password' value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        <button type='submit' style={{ marginTop: 12 }}>
          Login
        </button>
      </form>
    </div>
  );
};
