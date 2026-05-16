import { useEffect, useState } from 'react';
import { users, type User } from '../data/mock-data';
import { api } from '../services/api';

export function useUsers() {
  const [data, setData] = useState<User[]>(users);

  useEffect(() => {
    let active = true;
    api.getUsers().then((next) => {
      if (active) setData(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return data;
}
