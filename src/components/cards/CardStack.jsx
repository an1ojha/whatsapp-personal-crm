import { useState } from 'react'
import SwipeCard from './SwipeCard.jsx'

export default function CardStack({ contacts, onSwipeLeft, onSwipeRight, onTap }) {
  const [dragProgress, setDragProgress] = useState(0)

  const top3 = contacts.slice(0, 3)
  if (top3.length === 0) return null

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Render back-to-front so the top card is on top */}
      {top3.slice().reverse().map((contact, revIdx) => {
        const stackIndex = top3.length - 1 - revIdx
        return (
          <SwipeCard
            key={contact.id}
            contact={contact}
            stackIndex={stackIndex}
            dragProgress={dragProgress}
            onDragProgress={stackIndex === 0 ? setDragProgress : undefined}
            onSwipeLeft={() => onSwipeLeft(contact)}
            onSwipeRight={() => onSwipeRight(contact)}
            onTap={() => onTap(contact)}
          />
        )
      })}
    </div>
  )
}
