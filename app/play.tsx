import React, { useEffect, useRef, useCallback, memo, useMemo } from "react";
import { StyleSheet, TouchableOpacity, BackHandler, AppState, AppStateStatus, View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Video } from "expo-av";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import * as ScreenOrientation from "expo-screen-orientation";
import * as NavigationBar from "expo-navigation-bar";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { ThemedView } from "@/components/ThemedView";
import { PlayerControls } from "@/components/PlayerControls";
import { EpisodeSelectionModal } from "@/components/EpisodeSelectionModal";
import { SourceSelectionModal } from "@/components/SourceSelectionModal";
import { SpeedSelectionModal } from "@/components/SpeedSelectionModal";
import { SeekingBar } from "@/components/SeekingBar";
// import { NextEpisodeOverlay } from "@/components/NextEpisodeOverlay";
import VideoLoadingAnimation from "@/components/VideoLoadingAnimation";
import useDetailStore from "@/stores/detailStore";
import { useTVRemoteHandler } from "@/hooks/useTVRemoteHandler";
import Toast from "react-native-toast-message";
import usePlayerStore, { selectCurrentEpisode } from "@/stores/playerStore";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { useVideoHandlers } from "@/hooks/useVideoHandlers";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('PlayScreen');

// 优化的加载动画组件
const LoadingContainer = memo(
  ({ style, currentEpisode }: { style: any; currentEpisode: { url: string; title: string } | undefined }) => {
    logger.info(
      `[PERF] Video component NOT rendered - waiting for valid URL. currentEpisode: ${!!currentEpisode}, url: ${
        currentEpisode?.url ? "exists" : "missing"
      }`
    );
    return (
      <View style={style}>
        <VideoLoadingAnimation showProgressBar />
      </View>
    );
  }
);

LoadingContainer.displayName = "LoadingContainer";

// 移到组件外部避免重复创建
const createResponsiveStyles = (deviceType: string) => {
  const isMobile = deviceType === "mobile";
  const isTablet = deviceType === "tablet";

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "black",
      // 移动端和平板端可能需要状态栏处理
      ...(isMobile || isTablet ? { paddingTop: 0 } : {}),
    },
    videoContainer: {
      ...StyleSheet.absoluteFillObject,
      // 为触摸设备添加更多的交互区域
      ...(isMobile || isTablet ? { zIndex: 1 } : {}),
    },
    videoPlayer: {
      ...StyleSheet.absoluteFillObject,
    },
    loadingContainer: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 10,
    },
  });
};

export default function PlayScreen() {
  const videoRef = useRef<Video>(null);
  const router = useRouter();
  useKeepAwake();

  // 响应式布局配置
  const { deviceType } = useResponsiveLayout();
  const isTV = deviceType === "tv";

  const {
    episodeIndex: episodeIndexStr,
    position: positionStr,
    source: sourceStr,
    id: videoId,
    title: videoTitle,
  } = useLocalSearchParams<{
    episodeIndex: string;
    position?: string;
    source?: string;
    id?: string;
    title?: string;
  }>();
  const episodeIndex = parseInt(episodeIndexStr || "0", 10);
  const position = positionStr ? parseInt(positionStr, 10) : undefined;

  const { detail } = useDetailStore();
  const source = sourceStr || detail?.source;
  const id = videoId || detail?.id.toString();
  const title = videoTitle || detail?.title;
  const {
    isLoading,
    showControls,
    // showNextEpisodeOverlay,
    initialPosition,
    introEndTime,
    playbackRate,
    setVideoRef,
    handlePlaybackStatusUpdate,
    setShowControls,
    // setShowNextEpisodeOverlay,
    reset,
    loadVideo,
  } = usePlayerStore();
  const currentEpisode = usePlayerStore(selectCurrentEpisode);

  // 使用Video事件处理hook
  const { videoProps } = useVideoHandlers({
    videoRef,
    currentEpisode,
    initialPosition,
    introEndTime,
    playbackRate,
    handlePlaybackStatusUpdate,
    deviceType,
    detail: detail || undefined,
  });

  // TV遥控器处理 - 总是调用hook，但根据设备类型决定是否使用结果
  const tvRemoteHandler = useTVRemoteHandler();

  // 优化的动态样式 - 使用useMemo避免重复计算
  const dynamicStyles = useMemo(() => createResponsiveStyles(deviceType), [deviceType]);

  useEffect(() => {
    const perfStart = performance.now();
    logger.info(`[PERF] PlayScreen useEffect START - source: ${source}, id: ${id}, title: ${title}`);

    setVideoRef(videoRef);
    if (source && id && title) {
      logger.info(`[PERF] Calling loadVideo with episodeIndex: ${episodeIndex}, position: ${position}`);
      loadVideo({ source, id, episodeIndex, position, title });
    } else {
      logger.info(`[PERF] Missing required params - source: ${!!source}, id: ${!!id}, title: ${!!title}`);
    }

    const perfEnd = performance.now();
    logger.info(`[PERF] PlayScreen useEffect END - took ${(perfEnd - perfStart).toFixed(2)}ms`);

    return () => {
      logger.info(`[PERF] PlayScreen unmounting - calling reset()`);
      reset(); // Reset state when component unmounts
    };
  }, [episodeIndex, source, position, setVideoRef, reset, loadVideo, id, title]);

  // 进入播放页：移动端/平板自动横屏 + 沉浸式（隐藏状态栏与导航栏）；退出时还原
  useEffect(() => {
    if (isTV) return;

    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch((e) =>
      logger.warn("Failed to lock landscape orientation:", e)
    );
    NavigationBar.setVisibilityAsync("hidden").catch((e) => logger.warn("Failed to hide navigation bar:", e));
    NavigationBar.setBehaviorAsync("overlay-swipe").catch(() => {});

    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch((e) =>
        logger.warn("Failed to restore portrait orientation:", e)
      );
      NavigationBar.setVisibilityAsync("visible").catch(() => {});
    };
  }, [isTV]);

  // 移动端控制条自动隐藏
  useEffect(() => {
    if (isTV || !showControls) return;
    const timeoutId = setTimeout(() => {
      setShowControls(false);
    }, 4000);
    return () => clearTimeout(timeoutId);
  }, [isTV, showControls, setShowControls]);

  // 优化的屏幕点击处理（TV）
  const onScreenPress = useCallback(() => {
    if (deviceType === "tv") {
      tvRemoteHandler.onScreenPress();
    } else {
      setShowControls(!showControls);
    }
  }, [deviceType, tvRemoteHandler, setShowControls, showControls]);

  // ---- 触摸手势：单击切换控制条 / 双击播放暂停 / 长按 2 倍速 ----
  const previousRateRef = useRef<number>(1.0);

  const singleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(250)
        .onEnd(() => {
          const { showControls: sc, setShowControls: ssc } = usePlayerStore.getState();
          ssc(!sc);
        }),
    []
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDuration(250)
        .onEnd(() => {
          usePlayerStore.getState().togglePlayPause();
        }),
    []
  );

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(300)
        .onStart(() => {
          const state = usePlayerStore.getState();
          previousRateRef.current = state.playbackRate;
          if (state.playbackRate !== 2.0) {
            state.setPlaybackRate(2.0);
            Toast.show({ type: "info", text1: "2 倍速播放中", visibilityTime: 1200 });
          }
        })
        .onFinalize(() => {
          const state = usePlayerStore.getState();
          if (state.playbackRate === 2.0 && previousRateRef.current !== 2.0) {
            state.setPlaybackRate(previousRateRef.current);
          }
        }),
    []
  );

  const composedGestures = useMemo(
    () => Gesture.Exclusive(longPress, doubleTap, singleTap),
    [longPress, doubleTap, singleTap]
  );

  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        videoRef.current?.pauseAsync();
      }
    };

    const subscription = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const backAction = () => {
      if (showControls) {
        setShowControls(false);
        return true;
      }
      router.back();
      return true;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);

    return () => backHandler.remove();
  }, [showControls, setShowControls, router]);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (isLoading) {
      timeoutId = setTimeout(() => {
        if (usePlayerStore.getState().isLoading) {
          usePlayerStore.setState({ isLoading: false });
          Toast.show({ type: "error", text1: "播放超时，请重试" });
        }
      }, 60000); // 1 minute
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [isLoading]);

  if (!detail) {
    return <VideoLoadingAnimation showProgressBar />;
  }

  const renderVideoContent = () => (
    <>
      {/* 条件渲染Video组件：只有在有有效URL时才渲染 */}
      {currentEpisode?.url ? (
        <Video ref={videoRef} style={dynamicStyles.videoPlayer} {...videoProps} />
      ) : (
        <LoadingContainer style={dynamicStyles.loadingContainer} currentEpisode={currentEpisode} />
      )}

      {showControls &&
        (isTV ? (
          <PlayerControls showControls={showControls} setShowControls={setShowControls} />
        ) : (
          // 触摸设备：点击控制条空白处隐藏控制条（按钮自身事件优先，互不影响）
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowControls(false)}>
            <PlayerControls showControls={showControls} setShowControls={setShowControls} />
          </Pressable>
        ))}

      <SeekingBar />

      {/* 只在Video组件存在且正在加载时显示加载动画覆盖层 */}
      {currentEpisode?.url && isLoading && (
        <View style={dynamicStyles.loadingContainer}>
          <VideoLoadingAnimation showProgressBar />
        </View>
      )}

      {/* <NextEpisodeOverlay visible={showNextEpisodeOverlay} onCancel={() => setShowNextEpisodeOverlay(false)} /> */}
    </>
  );

  return (
    <ThemedView focusable style={dynamicStyles.container}>
      {/* 播放页隐藏手机状态栏 */}
      <StatusBar hidden />
      {isTV ? (
        <TouchableOpacity activeOpacity={1} style={dynamicStyles.videoContainer} onPress={onScreenPress}>
          {renderVideoContent()}
        </TouchableOpacity>
      ) : (
        <GestureDetector gesture={composedGestures}>
          <View style={dynamicStyles.videoContainer} collapsable={false}>
            {renderVideoContent()}
          </View>
        </GestureDetector>
      )}

      <EpisodeSelectionModal />
      <SourceSelectionModal />
      <SpeedSelectionModal />
    </ThemedView>
  );
}
