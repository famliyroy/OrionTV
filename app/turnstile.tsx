import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import useAuthStore from "@/stores/authStore";
import { ThemedText } from "@/components/ThemedText";

/**
 * Chrome Custom Tab 人机验证的深链回调路由：
 * 验证页（服务器 /app-turnstile.html）验证成功后跳转 oriontv://turnstile?token=...，
 * 本路由取出 token 写入全局 store，由 LoginModal 消费并自动重试登录/注册。
 */
export default function TurnstileCallbackScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const setTurnstileCallbackToken = useAuthStore((s) => s.setTurnstileCallbackToken);

  useEffect(() => {
    if (typeof token === "string" && token) {
      setTurnstileCallbackToken(token);
    }
    // 关闭 Custom Tab，返回应用（部分版本无返回值，直接忽略异常）
    try {
      WebBrowser.dismissBrowser();
    } catch (e) {
      /* ignore */
    }
    // 回到首页；登录弹窗是全局挂载的，状态由 store 保持
    router.replace("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color="#fff" size="large" />
      <ThemedText style={styles.text}>正在返回应用…</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
    gap: 12,
  },
  text: {
    color: "#ccc",
    fontSize: 14,
  },
});
