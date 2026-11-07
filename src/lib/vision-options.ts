import type { PoseModelPreference } from '@/domain/types'
export function visionPlan(preference: PoseModelPreference, blink: boolean, headPose: boolean) {
  const models = preference === 'lite' ? ['lite'] as const : preference === 'full' ? ['full'] as const : ['full', 'lite'] as const
  return {
    attempts: models.flatMap(model => (['GPU', 'CPU'] as const).map(delegate => ({ model, delegate, file: 'pose_landmarker_' + model + '.task' }))),
    useFace: blink || headPose,
    blink,
    headPose,
  }
}
