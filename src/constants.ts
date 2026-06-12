export const STORAGE_KEY = 'hce_trainer_v1'
export const ACTIVE_PROFILE_KEY = 'hce_trainer_active_profile'
export const GLOBAL_API_KEY_STORAGE_KEY = 'hce_trainer_api_key'

export const PROFILES = [
  { id: 'Shyam', label: 'Shyam' },
  { id: 'Parent', label: 'Parent' },
  { id: 'test', label: 'Test' },
] as const
export type ProfileId = (typeof PROFILES)[number]['id']

export const CATEGORIES = [
  { id: 'health-informatics', name: 'Health Informatics' },
  { id: 'therapeutics', name: 'Therapeutics' },
  { id: 'diagnostics', name: 'Diagnostics' },
  { id: 'support-services', name: 'Support Services' },
  { id: 'biotechnology', name: 'Biotechnology' },
  { id: 'communication', name: 'Communication' },
  { id: 'employability-skills', name: 'Employability Skills' },
  { id: 'healthcare-laws-ethics', name: 'Healthcare Laws & Ethics' },
  { id: 'safety-infection-control', name: 'Safety & Infection Control' },
  { id: 'lifespan-development', name: 'Lifespan Development' },
] as const

export type CategoryId = (typeof CATEGORIES)[number]['id']

export const DEFAULT_ESSAY_PROMPT =
  'Describe a health career in one of the five health career clusters. Include: the role of that career, required education/training, typical work environment, and why this career is important to healthcare.'

// The real ILC tiebreaker prompt is unknown in advance, so practice rotates
// across the three archetypes it is most likely to be drawn from.
export const ESSAY_ARCHETYPES = [
  {
    id: 'career',
    label: 'Career description',
    instruction:
      'Ask the student to describe one specific health career: its role and duties, required education/training, typical work environment, and why the career matters to healthcare. Vary which of the five health career clusters it points at.',
  },
  {
    id: 'motivation',
    label: 'Personal motivation',
    instruction:
      'Ask the student to explain why they want to pursue a career in healthcare, or what qualities and skills a great health professional needs, supported with specific examples.',
  },
  {
    id: 'scenario',
    label: 'Ethics / scenario',
    instruction:
      'Pose a short, realistic healthcare scenario involving ethics, confidentiality, patient rights, safety, or teamwork, and ask the student what the healthcare worker should do and why, using correct healthcare terms.',
  },
] as const

export const MOCK_ESSAY_PROMPTS = [
  DEFAULT_ESSAY_PROMPT,
  'Explain why you want to pursue a career in healthcare. Include: the personal qualities and skills that would make you a strong health professional, and at least two specific examples of how you would use them.',
  'A healthcare worker overhears two coworkers discussing a patient’s diagnosis in a hospital cafeteria. Explain what is wrong with this situation, which legal and ethical principles apply, and what the worker who overheard the conversation should do.',
] as const
