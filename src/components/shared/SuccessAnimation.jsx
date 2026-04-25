import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function SuccessAnimation({ onDone }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false)
      onDone?.()
    }, 750)
    return () => clearTimeout(t)
  }, [onDone])

  if (!visible) return null

  return createPortal(
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        width: 100,
        height: 100,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(52,211,153,0.25) 0%, transparent 70%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'successPop 0.75s cubic-bezier(0.32, 0.72, 0, 1) forwards',
      }}>
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
          <circle cx="26" cy="26" r="26" fill="rgba(52,211,153,0.2)" />
          <path
            d="M14 26L22 34L38 18"
            stroke="#34D399"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>,
    document.body
  )
}
