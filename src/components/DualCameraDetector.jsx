import { useRef, useCallback } from 'react';
import { Layers } from 'lucide-react';
import HighCameraDetector from './HighCameraDetector';
import LowCameraFeed from './LowCameraFeed';
import { useFusionQueue } from '../hooks/useFusionQueue';

export default function DualCameraDetector() {
  const { addTrigger, submitPlateResult } = useFusionQueue();
  const lowCamRef = useRef(null);

  // Called by HighCameraDetector when a vehicle crosses the plate zone
  const handleTrigger = useCallback((triggerData) => {
    addTrigger(triggerData);
    // Kick the low cam burst immediately, tagged with the trigger timestamp
    lowCamRef.current?.runBurst(triggerData.triggeredAt);
  }, [addTrigger]);

  // Called by LowCameraFeed when a burst OCR result is ready
  const handlePlateResult = useCallback((result) => {
    submitPlateResult(result);
  }, [submitPlateResult]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '10px' }}>
        <Layers size={16} color="#a855f7" />
        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#a855f7', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          Dual Camera Mode
        </span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>
          High cam tracks vehicles &amp; triggers · Low cam reads plates · Fusion queue matches results
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        <HighCameraDetector onTrigger={handleTrigger} />
        <LowCameraFeed ref={lowCamRef} onPlateResult={handlePlateResult} />
      </div>
    </div>
  );
}
