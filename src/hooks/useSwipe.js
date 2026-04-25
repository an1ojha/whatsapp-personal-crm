import { useRef, useEffect, useCallback } from 'react'

const SWIPE_THRESHOLD = 80
const VELOCITY_THRESHOLD = 0.4
const TAP_MAX_DISTANCE = 10
const TAP_MAX_DURATION = 220
const SNAP_BACK_DURATION = 350
const FLY_OFF_DURATION = 320
const ROTATION_FACTOR = 0.08
const MAX_ROTATION = 30

export function useSwipe(cardRef, { onSwipeLeft, onSwipeRight, onTap, onDrag, enabled = true }) {
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    startTime: 0,
    prevX: 0,
    prevTime: 0,
    velocitySamples: [],
    phase: 'idle', // idle | dragging | flying | snapping
  })

  const setTransform = useCallback((x, y, rot, transition = '') => {
    const el = cardRef.current
    if (!el) return
    el.style.transition = transition
    el.style.transform = `translateX(${x}px) translateY(${y}px) rotate(${rot}deg)`
  }, [cardRef])

  const clamp = (val, min, max) => Math.min(max, Math.max(min, val))

  const snapBack = useCallback(() => {
    const el = cardRef.current
    if (!el) return
    drag.current.phase = 'snapping'
    setTransform(0, 0, 0, `transform ${SNAP_BACK_DURATION}ms cubic-bezier(0.175, 0.885, 0.32, 1.275)`)
    onDrag?.(0)
    setTimeout(() => {
      drag.current.phase = 'idle'
      if (el) el.style.transition = ''
    }, SNAP_BACK_DURATION)
  }, [cardRef, setTransform, onDrag])

  const flyOff = useCallback((direction) => {
    const el = cardRef.current
    if (!el) return
    drag.current.phase = 'flying'
    const finalX = direction === 'left'
      ? -window.innerWidth * 1.5
      : window.innerWidth * 1.5
    const finalRot = direction === 'left' ? -45 : 45
    setTransform(finalX, 0, finalRot, `transform ${FLY_OFF_DURATION}ms cubic-bezier(0.4, 0, 1, 1)`)
    onDrag?.(direction === 'left' ? -1 : 1)
    setTimeout(() => {
      drag.current.phase = 'idle'
      if (direction === 'left') onSwipeLeft?.()
      else onSwipeRight?.()
    }, FLY_OFF_DURATION)
  }, [cardRef, setTransform, onSwipeLeft, onSwipeRight, onDrag])

  useEffect(() => {
    const el = cardRef.current
    if (!el || !enabled) return

    function onPointerDown(e) {
      if (drag.current.phase !== 'idle') return
      e.preventDefault()

      drag.current = {
        ...drag.current,
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        startTime: Date.now(),
        prevX: e.clientX,
        prevTime: Date.now(),
        velocitySamples: [],
        phase: 'dragging',
      }
      el.style.transition = ''
      el.setPointerCapture(e.pointerId)
    }

    function onPointerMove(e) {
      if (!drag.current.active || drag.current.phase !== 'dragging') return

      const now = Date.now()
      const dx = e.clientX - drag.current.prevX
      const dt = now - drag.current.prevTime || 1

      drag.current.velocitySamples.push({ dx, dt })
      if (drag.current.velocitySamples.length > 3) {
        drag.current.velocitySamples.shift()
      }

      drag.current.currentX = e.clientX
      drag.current.currentY = e.clientY
      drag.current.prevX = e.clientX
      drag.current.prevTime = now

      const deltaX = e.clientX - drag.current.startX
      const deltaY = e.clientY - drag.current.startY
      const rot = clamp(deltaX * ROTATION_FACTOR, -MAX_ROTATION, MAX_ROTATION)
      const liftY = -Math.abs(deltaX) * 0.04

      setTransform(deltaX, deltaY + liftY, rot)

      const progress = clamp(Math.abs(deltaX) / SWIPE_THRESHOLD, 0, 1)
      onDrag?.(deltaX > 0 ? progress : -progress)
    }

    function onPointerUp(e) {
      if (!drag.current.active || drag.current.phase !== 'dragging') return
      drag.current.active = false

      const deltaX = e.clientX - drag.current.startX
      const deltaY = e.clientY - drag.current.startY
      const duration = Date.now() - drag.current.startTime
      const totalDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

      // Compute average velocity
      const samples = drag.current.velocitySamples
      const velocityX = samples.length > 0
        ? samples.reduce((sum, s) => sum + s.dx / s.dt, 0) / samples.length
        : 0

      const distanceCommit = Math.abs(deltaX) > SWIPE_THRESHOLD
      const velocityCommit = Math.abs(velocityX) > VELOCITY_THRESHOLD
      const commit = distanceCommit || velocityCommit

      if (!commit) {
        if (totalDistance < TAP_MAX_DISTANCE && duration < TAP_MAX_DURATION) {
          onTap?.()
        }
        snapBack()
        return
      }

      const direction = deltaX < 0 ? 'left' : 'right'
      flyOff(direction)
    }

    function onPointerCancel() {
      if (!drag.current.active) return
      drag.current.active = false
      snapBack()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [cardRef, enabled, snapBack, flyOff, setTransform, onTap, onDrag])

  return { flyOff }
}
