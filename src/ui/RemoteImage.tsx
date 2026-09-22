/**
 * 远程图片（海报 / 剧照 / 头像）。
 *
 * 三件必须做的事：
 *   1. 走 imageProxyUrl()。豆瓣与 TMDB 都有防盗链，直连在 TV 上会拿到 403
 *      并且部分 Android TV 会缓存住这个失败结果，重进页面也不恢复。
 *   2. 三态（加载中 / 成功 / 失败）都要有可见的底，不能留白洞 —— TV 上
 *      大面积纯黑会让人以为是盒子没信号。
 *   3. 失败只切占位、不重试。原图挂了重试多少次都是挂，无限重试会把
 *      首页几十张图的请求放大成几百次。
 *
 * 不使用 expo-image（本项目未安装），用 RN 内置 Image。
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from 'react-native';
import { ImageOff } from 'lucide-react-native';
import { duration, palette, radius as radiusTokens } from '@core/theme';
import { imageProxyUrl } from '@api/repos/media';

type LoadStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface RemoteImageProps {
  uri?: string | null;
  width: number;
  height: number;
  radius?: number;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain';
  /** false 时直连（本地文件 / data: / 内网直连地址） */
  useProxy?: boolean;
}

export function RemoteImage({
  uri,
  width,
  height,
  radius = radiusTokens.md,
  style,
  resizeMode = 'cover',
  useProxy = true,
}: RemoteImageProps) {
  const [status, setStatus] = useState<LoadStatus>(uri ? 'loading' : 'empty');

  // 换图（比如横向滚动复用了同一个组件实例）时重置状态，否则会一直显示上一张的失败占位
  useEffect(() => {
    setStatus(uri ? 'loading' : 'empty');
  }, [uri]);

  const resolved = useMemo(() => {
    if (!uri) return '';
    return useProxy ? imageProxyUrl(uri) : uri;
  }, [uri, useProxy]);

  const boxStyle = [{ width, height, borderRadius: radius }];
  const iconSize = Math.max(20, Math.min(48, Math.round(Math.min(width, height) * 0.28)));

  if (status === 'empty' || status === 'error' || !resolved) {
    return (
      <View style={[styles.box, styles.placeholder, boxStyle, style]}>
        <ImageOff size={iconSize} color={palette.textMuted} />
      </View>
    );
  }

  return (
    <View style={[styles.box, boxStyle, style]}>
      <Image
        source={{ uri: resolved }}
        style={styles.image}
        resizeMode={resizeMode}
        fadeDuration={duration.fast}
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
      {/* 加载中：盖一层骨架底色（与占位同色，视觉上不闪） */}
      {status === 'loading' ? <View style={[StyleSheet.absoluteFill, styles.loadingCover]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
    backgroundColor: palette.bgCard,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loadingCover: {
    backgroundColor: palette.bgCard,
  },
});
