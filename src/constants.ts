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
