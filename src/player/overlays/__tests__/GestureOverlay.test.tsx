import React from 'react';
import renderer from 'react-test-renderer';
import { GestureOverlay } from '../GestureOverlay';

describe('GestureOverlay', () => {
  const defaultProps = {
    width: 800,
    height: 450,
    brightness: 1.0,
    onBrightnessChange: jest.fn(),
    volume: 0.8,
    onVolumeChange: jest.fn(),
    onSingleTap: jest.fn(),
    onDoubleTap: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly when active', () => {
    const tree = renderer.create(<GestureOverlay {...defaultProps} />).toJSON();
    expect(tree).toBeTruthy();
  });

  it('renders darkness overlay when brightness is reduced', () => {
    const tree = renderer.create(<GestureOverlay {...defaultProps} brightness={0.5} />).toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain('"backgroundColor":"#000000"');
  });

  it('does not render darkness overlay when brightness is 1.0', () => {
    const tree = renderer.create(<GestureOverlay {...defaultProps} brightness={1.0} />).toJSON();
    const json = JSON.stringify(tree);
    expect(json).not.toContain('"backgroundColor":"#000000"');
  });
});
