import Board from './Board'
import { ToastStack } from './components/Toast'

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Task Board</h1>
      </header>
      <Board />
      <ToastStack />
    </div>
  )
}
