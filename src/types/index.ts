export interface Track {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  coverPath?: string
  source: 'local' | 'netease' | 'qq'
  sourceId?: string
  sourceMediaMid?: string // QQ Music strMediaMid, needed for C400 trial URL
  localPath: string
  lyricsPath?: string
  addedAt: string
  lastPlayedAt?: string
  vip?: boolean // true if the song requires VIP (QQ Music pay.payplay === 1)
}

export interface Exercise {
  id: string
  name: string
  chineseName?: string
  bodyPart: string
  bodyPartZh?: string
  equipment: string
  equipmentZh?: string
  target: string
  targetZh?: string
  gifUrl?: string
  instructions?: string[]
  precautionsZh?: string
}

export interface WorkoutPlanItem {
  exerciseId: string
  sets: number
  reps: number
  restSeconds: number
}

export interface WorkoutPlan {
  id: string
  name: string
  bodyPart?: string
  equipment?: string
  exercises: WorkoutPlanItem[]
  createdAt: string
  updatedAt: string
}

export interface WorkoutRecord {
  id: string
  date: string
  planId?: string
  planName: string
  durationSeconds: number
  caloriesBurned?: number
  exercises: Array<{
    exerciseId: string
    setsCompleted: number
    repsCompleted: number
  }>
  completed: boolean
}

export type PlayMode = 'sequential' | 'repeat' | 'shuffle'
export type VisualizerPreset = 'cover' | 'tiles' | 'reactive' | 'lens' | 'crystalBloom' | 'nuage'
export type QualityLevel = 'high' | 'medium' | 'low'

export interface Playlist {
  id: string
  name: string
  coverPath?: string
  description?: string
  trackCount: number
  createdAt: string
  updatedAt: string
}

export interface TrainingTemplate {
  id: string
  name: string
  description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  bodyPart: string
  estimatedDuration: number // minutes
  exercises: WorkoutPlanItem[]
  icon: string // emoji or icon name
}

export interface PlayerState {
  currentTrack: Track | null
  queue: Track[]
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  playMode: PlayMode
  isLoading: boolean
}

export interface WorkoutSession {
  plan: WorkoutPlan
  currentExerciseIndex: number
  currentSet: number
  isResting: boolean
  restTimeLeft: number
  isPaused: boolean
  startTime: number
  exercisesProgress: Map<string, { setsCompleted: number; repsCompleted: number }>
}
