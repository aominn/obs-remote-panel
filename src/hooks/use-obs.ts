import { useEffect, useMemo, useState } from 'react'
import { MockObsController } from '../services/mock-obs-controller'
import { RealObsController } from '../services/obs-controller'
import type { ObsController } from '../services/obs-controller'
import type { ObsState } from '../types'

export function useObs(mockMode: boolean): { controller: ObsController; obsState: ObsState } {
  const controller = useMemo<ObsController>(
    () => (mockMode ? new MockObsController() : new RealObsController()),
    [mockMode]
  )
  const [obsState, setObsState] = useState(controller.getState())

  useEffect(() => {
    const unsubscribe = controller.subscribe(setObsState)
    return () => {
      unsubscribe()
      void controller.disconnect()
    }
  }, [controller])

  return { controller, obsState }
}
