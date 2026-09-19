import React, { useState, useRef, useEffect } from "react";
import { Modal, View, TextInput, StyleSheet, ActivityIndicator, Alert, Keyboard, InteractionManager } from "react-native";
import { usePathname } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import Toast from "react-native-toast-message";
import useAuthStore from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";
import useHomeStore from "@/stores/homeStore";
import { api } from "@/services/api";
import { LoginCredentialsManager } from "@/services/storage";
import { ThemedView } from "./ThemedView";
import { ThemedText } from "./ThemedText";
import { StyledButton } from "./StyledButton";

/** 服务器是否以「需要人机验证」拒绝了本次请求（即服务端未配置 APP_AUTH_KEY 豁免） */
const isTurnstileRequiredError = (message: string) =>
  message.includes("人机验证") || message.includes("请完成人机验证");

const toOrigin = (raw: string): string => {
  const matched = /^(https?:\/\/[^/]+)/i.exec(raw || "");
  return matched ? matched[1] : raw;
};

const LoginModal = () => {
  const {
    isLoginModalVisible,
    isLoginModalManuallyOpened,
    loginModalInitialMode,
    hideLoginModal,
    checkLoginStatus,
    turnstileCallbackToken,
    setTurnstileCallbackToken,
  } = useAuthStore();
  const { serverConfig, apiBaseUrl } = useSettingsStore();
  const { refreshPlayRecords } = useHomeStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // 登录 / 注册 模式切换
  const [mode, setMode] = useState<"login" | "register">("login");
  const usernameInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);
  const pathname = usePathname();
  const isSettingsPage = pathname.includes("settings");
  // 设置页默认不主动弹登录框，但用户在设置页主动点击「登录/注册」时可以弹出
  const shouldShowModal = isLoginModalVisible && (!isSettingsPage || isLoginModalManuallyOpened);

  const [isModalReady, setIsModalReady] = useState(false);

  // ---- Cloudflare Turnstile 人机验证（Chrome Custom Tab 方案）----
  // MoonTVPlus 服务端可通过 LoginRequireTurnstile / RegistrationRequireTurnstile 开启校验。
  // Android WebView 内置 Turnstile 不可行（系统 WebView 强制附加 X-Requested-With 头，
  // Cloudflare 必定判 600010），因此改为：登录请求先带 X-App-Auth 头尝试（服务端配置
  // APP_AUTH_KEY 豁免时直接成功）；被服务端要求验证时，打开服务器 /app-turnstile.html
  // 验证页（真实浏览器内核），验证成功经 oriontv://turnstile?token= 深链带回 token 后自动重试。
  const turnstileSiteKey = serverConfig?.TurnstileSiteKey || "";
  const [turnstileToken, setTurnstileToken] = useState("");
  const [verifyRequired, setVerifyRequired] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const verifyUrl = `${toOrigin(apiBaseUrl)}/app-turnstile.html?sitekey=${encodeURIComponent(turnstileSiteKey)}`;

  // 深链带回 token：消费后自动重试当前模式的登录/注册
  useEffect(() => {
    if (turnstileCallbackToken && verifyRequired) {
      const token = turnstileCallbackToken;
      setTurnstileCallbackToken(null);
      setVerifying(false);
      setTurnstileToken(token);
      if (mode === "login") {
        doLogin(token);
      } else {
        doRegister(token);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnstileCallbackToken]);

  const openTurnstilePage = async () => {
    setVerifying(true);
    try {
      await WebBrowser.openBrowserAsync(verifyUrl, {
        toolbarColor: "#000000",
        showTitle: false,
      });
    } catch (error) {
      setVerifying(false);
      Toast.show({
        type: "error",
        text1: "无法打开浏览器完成验证",
        text2: "TV 设备请为服务端配置 APP_AUTH_KEY 豁免（见 server/README.md）",
      });
    }
  };

  // Load saved credentials when modal opens
  useEffect(() => {
    if (shouldShowModal) {
      // 主动打开时按入口决定初始模式（登录 / 注册）
      setMode(loginModalInitialMode);

      // 先确保键盘状态清理
      Keyboard.dismiss();

      const loadCredentials = async () => {
        const savedCredentials = await LoginCredentialsManager.get();
        if (savedCredentials) {
          setUsername(savedCredentials.username);
          setPassword(savedCredentials.password);
        }
      };
      loadCredentials();

      // 延迟设置 Modal 就绪状态
      const readyTimeout = setTimeout(() => {
        setIsModalReady(true);
      }, 300);

      return () => {
        clearTimeout(readyTimeout);
        setIsModalReady(false);
      };
    }
  }, [shouldShowModal, loginModalInitialMode]);

  // Focus management with better TV remote handling
  useEffect(() => {
    if (isModalReady && shouldShowModal) {
      const isUsernameVisible = serverConfig?.StorageType !== "localstorage";

      // Use a small delay to ensure the modal is fully rendered
      const focusTimeout = setTimeout(() => {
        if (isUsernameVisible) {
          usernameInputRef.current?.focus();
        } else {
          passwordInputRef.current?.focus();
        }
      }, 300);

      return () => clearTimeout(focusTimeout);
    }
  }, [isModalReady, shouldShowModal, serverConfig]);

  // 清理 effect - 确保 Modal 关闭时清理所有状态
  useEffect(() => {
    return () => {
      Keyboard.dismiss();
      setIsModalReady(false);
    };
  }, []);

  const doLogin = async (tokenOverride?: string) => {
    const isLocalStorage = serverConfig?.StorageType === "localstorage";
    if (!password || (!isLocalStorage && !username)) {
      Toast.show({ type: "error", text1: "请输入用户名和密码" });
      return;
    }
    setIsLoading(true);
    try {
      await api.login(
        isLocalStorage ? undefined : username,
        password,
        (tokenOverride || turnstileToken) || undefined
      );
      await checkLoginStatus(apiBaseUrl);
      await refreshPlayRecords();

      // Save credentials on successful login
      await LoginCredentialsManager.save({ username, password });

      Toast.show({ type: "success", text1: "登录成功" });

      // 在登录成功后清理状态，再显示 Alert
      const hideAndAlert = () => {
        hideLoginModal();
        setIsModalReady(false);
        Keyboard.dismiss();

        setTimeout(() => {
          Alert.alert(
            "免责声明",
            "本应用仅提供影视信息搜索服务，所有内容均来自第三方网站。本站不存储任何视频资源，不对任何内容的准确性、合法性、完整性负责。",
            [{ text: "确定" }]
          );
        }, 100);
      };

      // 使用 InteractionManager 确保 UI 稳定后再执行
      InteractionManager.runAfterInteractions(hideAndAlert);

    } catch (error) {
      const message = error instanceof Error ? error.message : "用户名或密码错误";
      if (isTurnstileRequiredError(message)) {
        // 服务端未配置 APP_AUTH_KEY 豁免：引导用户经浏览器完成验证
        setVerifyRequired(true);
        setTurnstileToken("");
      }
      Toast.show({
        type: "error",
        text1: "登录失败",
        text2: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = () => doLogin();

  // 注册：不限制用户名和密码的字符数与格式，仅需非空
  const doRegister = async (tokenOverride?: string) => {
    if (!username || !password) {
      Toast.show({ type: "error", text1: "请输入用户名和密码" });
      return;
    }
    setIsLoading(true);
    try {
      await api.register(username, password, (tokenOverride || turnstileToken) || undefined);
      await checkLoginStatus(apiBaseUrl);
      await refreshPlayRecords();

      // 注册成功即视为登录，保存凭据
      await LoginCredentialsManager.save({ username, password });

      Toast.show({ type: "success", text1: "注册成功", text2: "已自动登录" });
      hideLoginModal();
      setIsModalReady(false);
      Keyboard.dismiss();
    } catch (error) {
      const message = error instanceof Error ? error.message : "服务器拒绝了注册请求";
      if (isTurnstileRequiredError(message)) {
        setVerifyRequired(true);
        setTurnstileToken("");
      }
      Toast.show({
        type: "error",
        text1: "注册失败",
        text2: message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = () => doRegister();

  // Handle navigation between inputs using returnKeyType
  const handleUsernameSubmit = () => {
    passwordInputRef.current?.focus();
  };

  // 主按钮：被服务端要求人机验证且尚未拿到 token 时，点击改为打开浏览器验证页
  const handlePrimaryPress = () => {
    if (verifyRequired && !turnstileToken) {
      openTurnstilePage();
      return;
    }
    return mode === "login" ? handleLogin() : handleRegister();
  };

  const primaryButtonText = isLoading
    ? ""
    : verifyRequired && !turnstileToken
    ? verifying
      ? "等待验证完成…"
      : "打开人机验证"
    : mode === "login"
    ? "登录"
    : "注册";

  const isLocalStorageServer = serverConfig?.StorageType === "localstorage";

  return (
    <Modal
      transparent={true}
      visible={shouldShowModal}
      animationType="fade"
      onRequestClose={hideLoginModal}
    >
      <View style={styles.overlay}>
        <ThemedView style={styles.container}>
          <ThemedText style={styles.title}>{mode === "login" ? "需要登录" : "注册账号"}</ThemedText>
          <ThemedText style={styles.subtitle}>
            {mode === "login" ? "服务器需要验证您的身份" : "创建新账号，用户名和密码长度不限"}
          </ThemedText>

          {/* 登录/注册 模式切换（仅多用户模式下显示） */}
          {!isLocalStorageServer && (
            <View style={styles.modeSwitch}>
              <StyledButton
                text="登录"
                onPress={() => setMode("login")}
                variant={mode === "login" ? "primary" : "ghost"}
                style={styles.modeButton}
              />
              <StyledButton
                text="注册"
                onPress={() => setMode("register")}
                variant={mode === "register" ? "primary" : "ghost"}
                style={styles.modeButton}
              />
            </View>
          )}

          {(serverConfig?.StorageType !== "localstorage" || mode === "register") && (
            <TextInput
              ref={usernameInputRef}
              style={styles.input}
              placeholder="请输入用户名"
              placeholderTextColor="#888"
              value={username}
              onChangeText={setUsername}
              returnKeyType="next"
              onSubmitEditing={handleUsernameSubmit}
              blurOnSubmit={false}
            />
          )}
          <TextInput
            ref={passwordInputRef}
            style={styles.input}
            placeholder="请输入密码"
            placeholderTextColor="#888"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            returnKeyType="go"
            onSubmitEditing={mode === "login" ? handleLogin : handleRegister}
          />

          {/* 服务端要求人机验证（未配置 APP_AUTH_KEY 豁免）时的引导 UI */}
          {verifyRequired && !turnstileToken && (
            <View style={styles.verifyBox}>
              <ThemedText style={styles.verifyHint}>
                服务器要求人机验证，将跳转到浏览器完成，完成后自动返回并继续{mode === "login" ? "登录" : "注册"}
              </ThemedText>
            </View>
          )}
          {verifyRequired && !!turnstileToken && (
            <View style={styles.verifyBox}>
              <ThemedText style={styles.verifyOk}>人机验证已完成</ThemedText>
            </View>
          )}

          <StyledButton
            text={primaryButtonText}
            onPress={handlePrimaryPress}
            disabled={isLoading || (verifyRequired && !turnstileToken && verifying)}
            style={styles.button}
            hasTVPreferredFocus={isLocalStorageServer && !verifyRequired}
          >
            {isLoading && <ActivityIndicator color="#fff" />}
          </StyledButton>
        </ThemedView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  container: {
    width: "80%",
    maxWidth: 400,
    padding: 24,
    borderRadius: 12,
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#ccc",
    marginBottom: 20,
    textAlign: "center",
  },
  input: {
    width: "100%",
    height: 50,
    backgroundColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 16,
    color: "#fff",
    fontSize: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#555",
  },
  button: {
    width: "100%",
    height: 50,
  },
  modeSwitch: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 20,
    width: "100%",
  },
  modeButton: {
    flex: 1,
    height: 44,
  },
  verifyBox: {
    width: "100%",
    marginBottom: 16,
  },
  verifyHint: {
    fontSize: 13,
    color: "#e5a04c",
    textAlign: "center",
    lineHeight: 20,
  },
  verifyOk: {
    fontSize: 13,
    color: "#4caf50",
    textAlign: "center",
  },
});

export default LoginModal;
