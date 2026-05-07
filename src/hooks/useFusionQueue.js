import { useRef, useCallback } from 'react';
import { useShop } from '../context/ShopContext';

const GLOBAL_COOLDOWN_MS  = 500;
const DUPLICATE_WINDOW_MS = 30_000;
const MAX_QUEUE           = 10;

export function useFusionQueue() {
  const { addVehicle, updateVehicle, updateVehicleStatus, removeVehicle, vehicles } = useShop();
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;

  // pending: [{ trackId, triggeredAt, direction, vehicleId, resolved }]
  const queue        = useRef([]);
  const lastTriggerAt = useRef(0);
  // set of plate texts with their first-seen timestamp
  const recentPlates = useRef(new Map());

  // Called by HighCameraDetector when a vehicle crosses the plate zone
  const addTrigger = useCallback(({ trackId, direction, vehicleId, imageUrl, confidence, vehicleType }) => {
    const now = Date.now();

    // Global cooldown
    if (now - lastTriggerAt.current < GLOBAL_COOLDOWN_MS) return;

    // Queue cap
    if (queue.current.filter(t => !t.resolved).length >= MAX_QUEUE) return;

    // Duplicate track guard — same track cannot trigger twice
    if (queue.current.some(t => t.trackId === trackId)) return;

    lastTriggerAt.current = now;

    // Add vehicle to WAITING immediately so the UI card appears
    addVehicle({
      id:               vehicleId,
      status:           'WAITING',
      pendingDirection: direction,
      plateStatus:      'scanning',
      imageUrl,
      type:             vehicleType || 'Car',
      confidence:       confidence  || 0,
      timestamp:        new Date().toISOString(),
      licensePlate:     '',
      plateImageUrl:    null,
      direction,
    });

    queue.current.push({
      trackId,
      triggeredAt: now,
      direction,
      vehicleId,
      resolved: false,
    });
  }, [addVehicle]);

  // Called by LowCameraFeed when a burst OCR result is ready
  const submitPlateResult = useCallback(({ plateText, confidence, plateImageUrl, burstStartTime, detectionLog }) => {
    const unresolved = queue.current.filter(t => !t.resolved);
    if (unresolved.length === 0) return;

    // Time-proximity match — find closest triggeredAt to burstStartTime, FIFO as tiebreaker
    let best = null;
    let bestDelta = Infinity;
    for (const trigger of unresolved) {
      const delta = Math.abs(trigger.triggeredAt - burstStartTime);
      if (delta < bestDelta) { bestDelta = delta; best = trigger; }
    }
    if (!best) return;

    best.resolved = true;
    const { vehicleId, direction } = best;

    // No plate found — leave in WAITING for manual entry
    if (!plateText) {
      updateVehicle(vehicleId, { plateStatus: 'not_found', detectionLog: detectionLog || [] });
      return;
    }

    const upper = plateText.toUpperCase();

    // Duplicate plate guard
    const now = Date.now();
    const lastSeen = recentPlates.current.get(upper);
    if (lastSeen && (now - lastSeen) < DUPLICATE_WINDOW_MS) {
      updateVehicle(vehicleId, { plateStatus: 'duplicate', detectionLog: detectionLog || [] });
      return;
    }
    recentPlates.current.set(upper, now);

    if (direction === 'INGRESS') {
      const existing = vehiclesRef.current.find(v =>
        v.id !== vehicleId &&
        !v.pendingDirection &&
        v.licensePlate?.toUpperCase() === upper &&
        (v.status === 'TEMP_OUT' || v.status === 'WAITING')
      );
      if (existing) {
        updateVehicleStatus(existing.id, 'ENTERED');
        removeVehicle(vehicleId);
      } else {
        updateVehicle(vehicleId, {
          licensePlate:     upper,
          plateImageUrl,
          plateStatus:      'found',
          pendingDirection: null,
          confidence,
          detectionLog:     detectionLog || [],
        });
        updateVehicleStatus(vehicleId, 'ENTERED');
      }
    } else {
      const entered = vehiclesRef.current.find(v =>
        v.id !== vehicleId &&
        v.licensePlate?.toUpperCase() === upper &&
        v.status === 'ENTERED'
      );
      if (entered) {
        updateVehicleStatus(entered.id, 'TEMP_OUT');
        removeVehicle(vehicleId);
      } else {
        updateVehicle(vehicleId, {
          licensePlate:  upper,
          plateImageUrl,
          plateStatus:   'not_found',
          detectionLog:  detectionLog || [],
        });
      }
    }

    // Prune old resolved entries to keep queue lean
    queue.current = queue.current.filter(t => !t.resolved || (Date.now() - t.triggeredAt) < 60_000);
  }, [updateVehicle, updateVehicleStatus, removeVehicle]);

  const pendingCount = useCallback(() => queue.current.filter(t => !t.resolved).length, []);

  return { addTrigger, submitPlateResult, pendingCount };
}
