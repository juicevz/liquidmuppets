import { useEffect, useRef, useState } from 'react'
import granatSoundtrack from '../assets/audio/granat-extended.mp3'

const DEFAULT_VOLUME = 45
const VOLUME_STORAGE_KEY = 'liquidmuppets-sound-volume'

function savedVolume() {
  try {
    const stored = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    if (stored === null) return DEFAULT_VOLUME
    const value = Number(stored)
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

function durationLabel(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '5:16'
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

export function LandingSoundControl() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const controlRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(savedVolume)
  const [duration, setDuration] = useState('5:16')
  const [playbackError, setPlaybackError] = useState('')

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.volume = volume / 100
  }, [volume])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!controlRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => () => audioRef.current?.pause(), [])

  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio) return
    setPlaybackError('')
    if (!audio.paused) {
      audio.pause()
      return
    }
    audio.volume = volume / 100
    try {
      await audio.play()
    } catch {
      setPlaying(false)
      setPlaybackError('Your browser paused it. Tap play once more.')
    }
  }

  const changeVolume = (nextVolume: number) => {
    const safeVolume = Math.min(100, Math.max(0, nextVolume))
    setVolume(safeVolume)
    if (audioRef.current) audioRef.current.volume = safeVolume / 100
    try {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(safeVolume))
    } catch {
      // Playback still works when storage is unavailable.
    }
  }

  return (
    <div className={`landing-sound-control${open ? ' is-open' : ''}${playing ? ' is-playing' : ''}`} ref={controlRef}>
      <audio
        ref={audioRef}
        src={granatSoundtrack}
        loop
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(durationLabel(event.currentTarget.duration))}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button
        type="button"
        className="sound-dock-tab"
        aria-label={`${open ? 'Close' : 'Open'} soundtrack controls. Sound ${playing ? 'on' : 'off'}.`}
        aria-controls="landing-sound-panel"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="sound-wave" aria-hidden="true"><i /><i /><i /></span>
        <span className="sound-dock-label">sound</span>
        <b>{playing ? 'on' : 'off'}</b>
      </button>
      {open && (
        <div className="sound-control-panel" id="landing-sound-panel" role="group" aria-label="Soundtrack controls">
          <div className="sound-panel-heading">
            <span><small>soundtrack</small><strong>Granat</strong></span>
            <b>{duration}</b>
          </div>
          <button type="button" className={`sound-playback-toggle${playing ? ' active' : ''}`} aria-pressed={playing} onClick={togglePlayback}>
            <span className="sound-playback-icon" aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span>
            <span><small>{playing ? 'playing at' : 'starts at'}</small><strong>{playing ? 'Pause soundtrack' : 'Play soundtrack'}</strong></span>
          </button>
          <label className="sound-volume-control">
            <span><small>volume</small><output>{volume}%</output></span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={volume}
              aria-label="Soundtrack volume"
              onChange={(event) => changeVolume(Number(event.target.value))}
            />
          </label>
          <p className={playbackError ? 'sound-control-error' : ''}>
            {playbackError || (playing ? 'Playing while you explore. Your volume choice stays saved.' : 'Off until you press play. Your volume choice stays saved.')}
          </p>
        </div>
      )}
    </div>
  )
}
