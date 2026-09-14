import React from 'react';
import { OptionsTelemetryCard } from './OptionsTelemetryCard';
import { OptionsTelemetryProps } from '@/types/options';

export const MetricMovementCell: React.FC<OptionsTelemetryProps> = (props) => {
  return (
    <td className="p-2 align-top">
      <OptionsTelemetryCard {...props} />
    </td>
  );
};
