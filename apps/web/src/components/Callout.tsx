import React from 'react';
import { CalloutType } from '@okw/markdown';
import { Info, Lightbulb, AlertTriangle, ShieldAlert, Quote, CheckSquare } from 'lucide-react';

interface CalloutProps {
  type: CalloutType;
  title: string;
  children: React.ReactNode;
}

export const Callout: React.FC<CalloutProps> = ({ type, title, children }) => {
  const getIcon = () => {
    switch (type) {
      case 'tip':
        return <Lightbulb size={16} color="#10b981" />;
      case 'warning':
        return <AlertTriangle size={16} color="#f59e0b" />;
      case 'caution':
      case 'important':
        return <ShieldAlert size={16} color="#ef4444" />;
      case 'quote':
        return <Quote size={16} color="#8b5cf6" />;
      case 'todo':
        return <CheckSquare size={16} color="#3b82f6" />;
      case 'note':
      case 'info':
      default:
        return <Info size={16} color="#6366f1" />;
    }
  };

  const getBorderColor = () => {
    switch (type) {
      case 'tip':
        return '#10b981';
      case 'warning':
        return '#f59e0b';
      case 'caution':
      case 'important':
        return '#ef4444';
      case 'quote':
        return '#8b5cf6';
      case 'todo':
        return '#3b82f6';
      case 'note':
      case 'info':
      default:
        return '#6366f1';
    }
  };

  return (
    <div
      className={`callout callout-${type}`}
      style={{
        borderLeft: `4px solid ${getBorderColor()}`,
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 16px',
        margin: '14px 0',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>
        {getIcon()}
        <span>{title}</span>
      </div>
      <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  );
};
