import { ENDPOINTS } from '@chat/contracts';
import { config } from '@/config/env';
import { logger } from '@/lib/logger';
import { getApi } from '@/lib/services';

/**
 * Short-lived coturn credentials from the API. If the request fails (or the server has no TURN),
 * the call still starts with the STUN list from config: it works on most networks, just not all.
 */
export const fetchIceServers = async (): Promise<RTCIceServer[]> => {
  try {
    const { ice_servers } = await getApi().call(ENDPOINTS.calls.turn);
    if (ice_servers.length > 0) return ice_servers;
  } catch (error) {
    logger.warn('TURN credentials unavailable, using STUN only:', error);
  }
  return [...config.webrtc.iceServers];
};
