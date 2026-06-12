import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/index.css'
import { initStore } from './demoData'

const root = ReactDOM.createRoot(document.getElementById('root'))

// 로딩 화면
root.render(
  <div style={{
    display:'flex', alignItems:'center', justifyContent:'center',
    height:'100vh', fontFamily:'system-ui, sans-serif', color:'#555'
  }}>
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:'15px' }}>데이터를 불러오는 중…</div>
    </div>
  </div>
)

// Firebase에서 데이터를 먼저 불러온 뒤 앱을 그립니다.
initStore()
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  })
  .catch((e) => {
    console.error(e)
    root.render(
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'center',
        height:'100vh', fontFamily:'system-ui, sans-serif', color:'#c00',
        padding:'20px', textAlign:'center'
      }}>
        <div>
          <div style={{ fontSize:'16px', fontWeight:700, marginBottom:'8px' }}>
            데이터 연결에 실패했어요
          </div>
          <div style={{ fontSize:'14px', color:'#666' }}>
            인터넷 연결을 확인한 뒤 새로고침해 주세요.
          </div>
        </div>
      </div>
    )
  })
