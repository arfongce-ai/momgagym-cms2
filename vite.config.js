import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// [성능 개선 2026-09] App.jsx의 라우트별 React.lazy 스플리팅과 짝을 이루는 조치.
// recharts(차트 라이브러리)는 무겁지만 Revenue/Report/AI리포트 등 일부 화면에서만
// 쓰이므로, 별도 vendor 청크로 분리해두면 그 화면들을 처음 열 때만 받아오고
// 나머지 화면(스케줄·회원목록 등)은 이 무게를 전혀 지지 않는다.
// react/react-dom/react-router-dom은 거의 모든 화면이 같이 쓰므로 별도 vendor
// 청크로 묶어두면 페이지 이동 시마다 매번 새로 받지 않고 브라우저 캐시를 재사용한다.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
        },
      },
    },
  },
})
