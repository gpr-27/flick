import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';

// Calls for talking to Flick: memories, topics, feedback, follow-ups, speed.

export const listMemories = () =>
  getApi()
    .call(ENDPOINTS.flick.memories)
    .then((r) => r.memories);
export const updateMemory = (id: string, fact: string) =>
  getApi().call(ENDPOINTS.flick.updateMemory, { params: { id }, body: { fact } });
export const deleteMemory = (id: string) =>
  getApi().call(ENDPOINTS.flick.deleteMemory, { params: { id } });
export const clearMemories = () => getApi().call(ENDPOINTS.flick.clearMemories);
export const addMemory = (fact: string) =>
  getApi().call(ENDPOINTS.flick.addMemory, { body: { fact } });

export const listTopics = () =>
  getApi()
    .call(ENDPOINTS.flick.topics)
    .then((r) => r.topics);
export const startTopic = (title?: string) =>
  getApi().call(ENDPOINTS.flick.newTopic, { body: title ? { title } : {} });
export const resumeTopic = (id: string) =>
  getApi().call(ENDPOINTS.flick.resumeTopic, { params: { id } });
export const renameTopic = (id: string, title: string) =>
  getApi().call(ENDPOINTS.flick.renameTopic, { params: { id }, body: { title } });

export const sendFeedback = (message_id: string, rating: 'up' | 'down') =>
  getApi().call(ENDPOINTS.flick.feedback, { body: { message_id, rating } });
export const getFollowups = (message_id: string) =>
  getApi()
    .call(ENDPOINTS.flick.followups, { body: { message_id } })
    .then((r) => r.suggestions);

export const getSpeed = () =>
  getApi()
    .call(ENDPOINTS.ai.preference)
    .then((r) => r.speed);
export const setSpeed = (speed: 'fast' | 'quality') =>
  getApi().call(ENDPOINTS.ai.setPreference, { body: { speed } });
export const transcribeAttachment = (attachment_id: string) =>
  getApi()
    .call(ENDPOINTS.ai.transcribe, { body: { attachment_id } })
    .then((r) => r.text);
