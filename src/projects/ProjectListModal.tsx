import React, { useEffect, useState } from 'react';
import { listProjects, deleteProject } from '../persistence/indexeddb/projectRepository';
import type { ProjectEntity } from '../persistence/indexeddb/database';
import styles from './ProjectListModal.module.css';

interface ProjectListModalProps {
  isOpen: boolean;
  activeProjectId?: string;
  onClose: () => void;
  onSelectProject: (projectId: string) => void;
  onNewProject: () => void;
}

export function ProjectListModal({
  isOpen,
  activeProjectId,
  onClose,
  onSelectProject,
  onNewProject,
}: ProjectListModalProps): React.ReactElement | null {
  const [projects, setProjects] = useState<ProjectEntity[]>([]);
  const [loading, setLoading] = useState(false);

  const refreshProjects = async () => {
    setLoading(true);
    try {
      const list = await listProjects();
      setProjects(list);
    } catch (err) {
      console.error('Failed to list projects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void refreshProjects();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this project?')) {
      await deleteProject(id);
      await refreshProjects();
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Projects</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div style={{ padding: '8px 16px', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className={styles.openBtn}
            onClick={() => {
              onNewProject();
              onClose();
            }}
          >
            + New Project
          </button>
        </div>

        <div className={styles.list}>
          {loading ? (
            <div className={styles.emptyText}>Loading projects...</div>
          ) : projects.length === 0 ? (
            <div className={styles.emptyText}>No saved projects yet.</div>
          ) : (
            projects.map(p => {
              const isActive = p.id === activeProjectId;
              return (
                <div
                  key={p.id}
                  className={`${styles.projectItem} ${isActive ? styles.projectActive : ''}`}
                >
                  <div className={styles.info}>
                    <span className={styles.name}>{p.name}</span>
                    <span className={styles.date}>
                      {new Date(p.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.openBtn}
                      onClick={() => {
                        onSelectProject(p.id);
                        onClose();
                      }}
                    >
                      {isActive ? 'Active' : 'Open'}
                    </button>
                    <button
                      className={styles.delBtn}
                      onClick={e => handleDelete(e, p.id)}
                      title="Delete Project"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
