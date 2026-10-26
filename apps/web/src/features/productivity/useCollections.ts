import { useCallback, useState } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';

export interface Collection {
  id: string;
  name: string;
}

/** The person's bookmark collections (the server creates Work, Ideas and Links on first use). */
export const useCollections = () => {
  const [items, setItems] = useState<Collection[]>([]);
  const reload = useCallback(async () => {
    try {
      setItems((await getApi().call(ENDPOINTS.productivity.collections)).items);
    } catch {
      setItems([]);
    }
  }, []);
  return { items, reload };
};
