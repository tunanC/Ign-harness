import '../styles/hint-icon.css';
import { Tooltip } from './Tooltip';

interface Props {
  message: string;
  variant?: 'solid' | 'glasses';
}

export function HintIcon({ message, variant = 'solid' }: Props) {
  return (
    <Tooltip text={message} variant={variant}>
      <span className={`hint-icon hint-icon--${variant}`}>?</span>
    </Tooltip>
  );
}
