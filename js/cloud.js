/**
 * Hook for a future cross-device transport.
 * Tony's laptop and the HDMI TV are the same computer, so the live path is
 * BroadcastChannel plus localStorage in display.js and teacher.js.
 * To add another room later, replace this function. It must return
 * { send(message), close() } and call onMessage for each message received.
 * Do not put secrets in this file.
 */
export function connectCloud(_onMessage) {
  return { send() {}, close() {} };
}
