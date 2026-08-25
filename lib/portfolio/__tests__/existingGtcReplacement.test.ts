import { describe, expect, it, vi } from 'vitest';
import {
  cancelExistingGtcForReplacement,
  restoreOriginalGtcIfNeeded,
} from '../existingGtcReplacement';

describe('existing GTC replacement safety', () => {
  it('does not proceed to replacement when cancellation fails', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('cancel rejected'));
    const submitReplacement = vi.fn();

    await expect(
      (async () => {
        await cancelExistingGtcForReplacement(
          {
            hasGtc: true,
            confirmed: true,
            orderId: 'GTC-1',
            originalPrice: 4.03,
          },
          cancel,
        );
        await submitReplacement();
      })(),
    ).rejects.toThrow('cancel rejected');

    expect(cancel).toHaveBeenCalledWith('GTC-1');
    expect(submitReplacement).not.toHaveBeenCalled();
  });

  it('restores the original simple GTC when replacement fails after cancellation', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const restore = vi.fn().mockResolvedValue('RESTORED-1');

    const cancelled = await cancelExistingGtcForReplacement(
      {
        hasGtc: true,
        confirmed: true,
        orderId: 'GTC-1',
        originalPrice: 4.03,
      },
      cancel,
    );
    const result = await restoreOriginalGtcIfNeeded(
      {
        cancelled: cancelled.cancelled,
        replacementSubmitted: false,
        originalPrice: cancelled.originalPrice,
      },
      restore,
    );

    expect(result).toBe('RESTORED-1');
    expect(restore).toHaveBeenCalledWith(4.03);
  });

  it('propagates restoration failure for the critical broker warning', async () => {
    const restore = vi.fn().mockRejectedValue(new Error('restore rejected'));

    await expect(
      restoreOriginalGtcIfNeeded(
        {
          cancelled: true,
          replacementSubmitted: false,
          originalPrice: 4.03,
        },
        restore,
      ),
    ).rejects.toThrow('restore rejected');
  });

  it('blocks complex/OCO replacement before cancellation', async () => {
    const cancel = vi.fn();

    await expect(
      cancelExistingGtcForReplacement(
        {
          hasGtc: true,
          confirmed: true,
          orderId: 'GTC-1',
          complexOrderId: 'OCO-1',
          originalPrice: 4.03,
        },
        cancel,
      ),
    ).rejects.toThrow('Manage that order in TastyTrade');

    expect(cancel).not.toHaveBeenCalled();
  });

  it('does not restore when a replacement was already accepted', async () => {
    const restore = vi.fn();

    const result = await restoreOriginalGtcIfNeeded(
      {
        cancelled: true,
        replacementSubmitted: true,
        originalPrice: 4.03,
      },
      restore,
    );

    expect(result).toBeNull();
    expect(restore).not.toHaveBeenCalled();
  });
});
