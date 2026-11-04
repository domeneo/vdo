import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api';

type Folder = { id: number; name: string; path: string };

export const FolderList: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const [folders, setFolders] = useState<Folder[]>([]);

  const load = async () => {
    const data = await apiFetch('/api/folders');
    setFolders(data);
  };

  const hide = async (id: number) => {
    await apiFetch(`/api/folders/${id}/hide`, { method: 'POST' });
    load();
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <h2>Folders</h2>
      <ul>
        {folders.map(f => (
          <li key={f.id}>
            {f.name}
            {isAdmin && (
              <button style={{ marginLeft: 8 }} onClick={() => hide(f.id)}>
                Hide for users
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
