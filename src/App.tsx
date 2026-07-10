import Board from './Board'
import { OfflineBanner } from './components/OfflineBanner'
import { ToastStack } from './components/Toast'
import { useOnline } from './hooks/useOnline'

export default function App() {
  useOnline()
  return (
    <div className="app">
      <OfflineBanner />
      <header className="app-header">
        <h1>Task Board</h1>
      </header>
      <Board />
      <ToastStack />
    </div>
  )
}
