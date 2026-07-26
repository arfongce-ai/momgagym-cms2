import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist' },
  test: {
    // copy/ 는 src/ 로 옮겨 붙일 예정인 미연결 프로토타입(종합리포트) 사본이라
    // 상대경로(../demoData 등)가 이 위치에서는 풀리지 않는다. 정식 스캔에서 제외.
    exclude: [...configDefaults.exclude, 'copy/**'],
  },
})
