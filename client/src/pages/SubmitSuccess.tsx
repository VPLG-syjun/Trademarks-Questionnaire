import { Link } from 'react-router-dom';

export default function SubmitSuccess() {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '60px 40px' }}>
      <div style={{ fontSize: '4rem', marginBottom: '20px' }}>&#10003;</div>
      <h2 style={{ color: '#22c55e', marginBottom: '15px' }}>설문이 제출되었습니다!</h2>
      <p style={{ color: '#6b7280', marginBottom: '30px' }}>
        소중한 의견 감사합니다.<br />
        관리자 검토 후 문서가 생성됩니다.
      </p>
      <Link to="/" className="btn btn-primary">
        새 설문 작성하기
      </Link>
    </div>
  );
}
