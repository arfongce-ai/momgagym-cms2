import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'
import { installPreventPullRefresh } from './utils/preventPullRefresh'

// 아래로 끌어당기면 새로고침되어 측정·리포트가 날아가는 것을 막는다(CSS가 안 먹는 브라우저 보조).
installPreventPullRefresh()

// 데이터 로딩(initStore)은 로그인 이후에 수행한다(AuthContext).
// 비로그인 상태에서 Firestore를 읽으면 보안 규칙에 막혀(permission-denied)
// 앱 전체가 멈추기 때문이다. 따라서 시작 시엔 바로 App 을 렌더하고,
// 로그인 화면 → 로그인 성공 → 그때 데이터를 불러온다.
const root = ReactDOM.createRoot(document.getElementById('root'))
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
