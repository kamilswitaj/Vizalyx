import React, { useState } from 'react';
import type { ImageEditProvider } from '../providers/contracts/types';
import styles from './SettingsModal.module.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  openAiKey: string;
  onSaveKey: (key: string) => void;
  openAiProvider: ImageEditProvider;
}

export function SettingsModal({
  isOpen,
  onClose,
  openAiKey,
  onSaveKey,
  openAiProvider,
}: Props): React.ReactElement | null {
  const [inputKey, setInputKey] = useState(openAiKey);
  const [isValidating, setIsValidating] = useState(false);
  const [validationStatus, setValidationStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  if (!isOpen) return null;

  const handleValidate = async () => {
    const trimmed = inputKey.trim();
    if (!trimmed) {
      setValidationStatus('invalid');
      setStatusMessage('Please enter an API key');
      return;
    }

    setIsValidating(true);
    setStatusMessage('Validating credentials with OpenAI...');

    try {
      const res = await openAiProvider.validateCredentials({ apiKey: trimmed });
      if (res.valid) {
        setValidationStatus('valid');
        setStatusMessage('Connected successfully');
        onSaveKey(trimmed);
      } else {
        setValidationStatus('invalid');
        setStatusMessage(res.error || 'Validation failed');
      }
    } catch (e) {
      setValidationStatus('invalid');
      setStatusMessage(e instanceof Error ? e.message : 'Validation failed');
    } finally {
      setIsValidating(false);
    }
  };

  const handleClear = () => {
    setInputKey('');
    setValidationStatus('idle');
    setStatusMessage('');
    onSaveKey('');
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>Settings</div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>OpenAI BYOK Configuration</div>
            <div className={styles.inputGroup}>
              <input
                type="password"
                className={styles.keyInput}
                placeholder="sk-..."
                value={inputKey}
                onChange={e => {
                  setInputKey(e.target.value);
                  setValidationStatus('idle');
                  setStatusMessage('');
                }}
                disabled={isValidating}
              />
              <button
                className={styles.btn}
                onClick={handleValidate}
                disabled={isValidating || !inputKey.trim()}
              >
                {isValidating ? 'Checking...' : 'Validate'}
              </button>
              {inputKey && (
                <button
                  className={styles.btnSecondary}
                  onClick={handleClear}
                  disabled={isValidating}
                >
                  Clear
                </button>
              )}
            </div>

            <div className={styles.statusRow}>
              Status:{' '}
              {validationStatus === 'valid' && (
                <span className={styles.statusConnected}>● {statusMessage || 'Connected'}</span>
              )}
              {validationStatus === 'invalid' && (
                <span className={styles.statusInvalid}>● {statusMessage || 'Invalid'}</span>
              )}
              {validationStatus === 'idle' && (
                <span className={styles.statusIdle}>
                  {openAiKey ? '● Key entered (unvalidated)' : '○ Not configured'}
                </span>
              )}
            </div>
          </div>

          <div className={styles.privacyCallout}>
            <strong>Security note:</strong> Your API key is held exclusively in application memory
            on this device. It is never stored in browser persistence (cookies, localStorage, or
            IndexedDB) and is never transmitted to any Vizalyx server.
          </div>
        </div>
      </div>
    </div>
  );
}
