import type { LifeThreadKind } from "./life-thread.service.js";

export const LIFE_THREAD_MAX_ONBOARDING = 2;
export const LIFE_THREAD_STAGGER_DAYS = 3;
export const OPEN_LOOP_MAX_PER_REFLECTION = 2;

export const LIFE_THREAD_SCHEDULE_DAYS: Record<LifeThreadKind, number> = {
  health_wait: 3,
  family_care: 5,
  crisis: 2,
  generic: 7
};
