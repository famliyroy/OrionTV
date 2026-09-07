import React, { useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, PanResponder } from "react-native";
import { Pause, Play, SkipBack, SkipForward, List, Gauge } from "lucide-react-native";
import { ThemedText } from "@/components/ThemedText";
import { MediaButton } from "@/components/MediaButton";

import usePlayerStore from "@/stores/playerStore";
import useDetailStore from "@/stores/detailStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";

interface PlayerControlsProps {
  showControls: boolean;
  setShowControls: (show: boolean) => void;
}

export const PlayerControls: React.FC<PlayerControlsProps> = ({ showControls, setShowControls }) => {
  const {
    currentEpisodeIndex,
    episodes,
    status,
    isSeeking,
    seekPosition,
    progressPosition,
    playbackRate,
    togglePlayPause,
    playEpisode,
    seekTo,
    setShowEpisodeModal,
    setShowSpeedModal,
  } = usePlayerStore();

  const { detail } = useDetailStore();
  const { deviceType } = useResponsiveLayout();
  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";

  const videoTitle = detail?.title || "";
  const currentEpisode = episodes[currentEpisodeIndex];
  const currentEpisodeTitle = currentEpisode?.title;
  const hasNextEpisode = currentEpisodeIndex < (episodes.length || 0) - 1;
  const hasPrevEpisode = currentEpisodeIndex > 0;

  // ---- 可拖动进度条 ----
  const [barWidth, setBarWidth] = useState(0);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const dragRatioRef = useRef<number | null>(null);

  const durationMillis = status?.isLoaded ? status.durationMillis || 0 : 0;

  // 用 ref 保存实时值，避免 PanResponder 闭包捕获首次渲染的旧值
  const barWidthRef = useRef(0);
  const durationRef = useRef(0);
  barWidthRef.current = barWidth;
  durationRef.current = durationMillis;

  const clampRatio = (ratio: number) => Math.max(0, Math.min(1, ratio));

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        if (barWidthRef.current <= 0) return;
        const ratio = clampRatio(evt.nativeEvent.locationX / barWidthRef.current);
        dragRatioRef.current = ratio;
        setDragRatio(ratio);
      },
      onPanResponderMove: (evt) => {
        if (barWidthRef.current <= 0) return;
        const ratio = clampRatio(evt.nativeEvent.locationX / barWidthRef.current);
        dragRatioRef.current = ratio;
        setDragRatio(ratio);
      },
      onPanResponderRelease: () => {
        const ratio = dragRatioRef.current;
        if (ratio !== null && durationRef.current > 0) {
          usePlayerStore.getState().seekTo(ratio * durationRef.current);
        }
        dragRatioRef.current = null;
        setDragRatio(null);
      },
      onPanResponderTerminate: () => {
        dragRatioRef.current = null;
        setDragRatio(null);
      },
    })
  ).current;

  const displayRatio = dragRatio !== null ? dragRatio : isSeeking ? seekPosition : progressPosition;

  const formatTime = (milliseconds: number) => {
    if (!milliseconds) return "00:00";
    const totalSeconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  };

  const onPlayNextEpisode = () => {
    if (hasNextEpisode) {
      playEpisode(currentEpisodeIndex + 1);
    }
  };

  const onPlayPrevEpisode = () => {
    if (hasPrevEpisode) {
      playEpisode(currentEpisodeIndex - 1);
    }
  };

  // 紧凑尺寸：按手机 16:10 横屏优化
  const sizes = useMemo(() => {
    if (isMobile) {
      return { icon: 20, buttonPadding: 6, gap: 6, overlayPaddingH: 12, overlayPaddingV: 6, title: 13, time: 11, barHeight: 4, thumb: 12, marginTop: 6 };
    }
    if (isTablet) {
      return { icon: 22, buttonPadding: 8, gap: 8, overlayPaddingH: 16, overlayPaddingV: 10, title: 15, time: 12, barHeight: 6, thumb: 14, marginTop: 8 };
    }
    return { icon: 24, buttonPadding: 10, gap: 10, overlayPaddingH: 20, overlayPaddingV: 14, title: 16, time: 13, barHeight: 8, thumb: 16, marginTop: 12 };
  }, [isMobile, isTablet]);

  return (
    <View
      style={[
        styles.controlsOverlay,
        { paddingHorizontal: sizes.overlayPaddingH, paddingVertical: sizes.overlayPaddingV },
      ]}
    >
      <View style={styles.topControls}>
        <Text style={[styles.controlTitle, { fontSize: sizes.title }]} numberOfLines={1}>
          {videoTitle} {currentEpisodeTitle ? `- ${currentEpisodeTitle}` : ""}
        </Text>
      </View>

      <View style={styles.bottomControlsContainer}>
        <View
          style={[styles.progressBarContainer, { height: Math.max(sizes.barHeight, 24) }]}
          onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
          {...panResponder.panHandlers}
        >
          <View style={[styles.progressBarBackground, { height: sizes.barHeight, top: (Math.max(sizes.barHeight, 24) - sizes.barHeight) / 2 }]} />
          <View
            style={[
              styles.progressBarFilled,
              {
                height: sizes.barHeight,
                top: (Math.max(sizes.barHeight, 24) - sizes.barHeight) / 2,
                width: `${displayRatio * 100}%`,
              },
            ]}
          />
          <View
            style={[
              styles.progressThumb,
              {
                width: sizes.thumb,
                height: sizes.thumb,
                borderRadius: sizes.thumb / 2,
                top: (Math.max(sizes.barHeight, 24) - sizes.thumb) / 2,
                left: `${displayRatio * 100}%`,
                marginLeft: -sizes.thumb / 2,
              },
            ]}
          />
        </View>

        <ThemedText style={{ color: "white", marginTop: 2, fontSize: sizes.time }}>
          {status?.isLoaded
            ? `${formatTime(dragRatio !== null ? dragRatio * durationMillis : status.positionMillis)} / ${formatTime(durationMillis)}`
            : "00:00 / 00:00"}
        </ThemedText>

        <View style={[styles.bottomControls, { gap: sizes.gap, marginTop: sizes.marginTop }]}>
          <MediaButton onPress={onPlayPrevEpisode} disabled={!hasPrevEpisode} style={{ padding: sizes.buttonPadding, minWidth: 0 }}>
            <SkipBack color={hasPrevEpisode ? "white" : "#666"} size={sizes.icon} />
          </MediaButton>

          <MediaButton onPress={togglePlayPause} hasTVPreferredFocus={showControls} style={{ padding: sizes.buttonPadding, minWidth: 0 }}>
            {status?.isLoaded && status.isPlaying ? (
              <Pause color="white" size={sizes.icon} />
            ) : (
              <Play color="white" size={sizes.icon} />
            )}
          </MediaButton>

          <MediaButton onPress={onPlayNextEpisode} disabled={!hasNextEpisode} style={{ padding: sizes.buttonPadding, minWidth: 0 }}>
            <SkipForward color={hasNextEpisode ? "white" : "#666"} size={sizes.icon} />
          </MediaButton>

          <MediaButton
            onPress={() => setShowSpeedModal(true)}
            timeLabel={playbackRate !== 1.0 ? `${playbackRate}x` : undefined}
            style={{ padding: sizes.buttonPadding, minWidth: 0 }}
          >
            <Gauge color="white" size={sizes.icon} />
          </MediaButton>

          <MediaButton onPress={() => setShowEpisodeModal(true)} style={{ padding: sizes.buttonPadding, minWidth: 0 }}>
            <List color="white" size={sizes.icon} />
          </MediaButton>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "space-between",
  },
  topControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  controlTitle: {
    color: "white",
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
    marginHorizontal: 10,
  },
  bottomControlsContainer: {
    width: "100%",
    alignItems: "center",
  },
  bottomControls: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
  },
  progressBarContainer: {
    width: "100%",
    position: "relative",
    justifyContent: "center",
  },
  progressBarBackground: {
    position: "absolute",
    left: 0,
    right: 0,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 4,
  },
  progressBarFilled: {
    position: "absolute",
    left: 0,
    backgroundColor: "#fff",
    borderRadius: 4,
  },
  progressThumb: {
    position: "absolute",
    backgroundColor: "#fff",
    elevation: 2,
  },
});
