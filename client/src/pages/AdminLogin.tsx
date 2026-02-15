import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const ADMIN_ID = 'FR6066';
const ADMIN_PW = '6066';

export default function AdminLogin() {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (id === ADMIN_ID && password === ADMIN_PW) {
      sessionStorage.setItem('adminAuth', 'true');
      navigate('/admin');
    } else {
      setError('아이디 또는 비밀번호가 올바르지 않습니다.');
    }
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h2>관리자 로그인</h2>
        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label htmlFor="id">아이디</label>
            <input
              type="text"
              id="id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="아이디를 입력하세요"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">비밀번호</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              required
            />
          </div>
          {error && <p className="error-message">{error}</p>}
          <button type="submit" className="login-button">
            로그인
          </button>
        </form>
      </div>
    </div>
  );
}
