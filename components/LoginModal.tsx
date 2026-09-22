import React, { useState, useRef, useEffect } from "react";
import { Modal, View, TextInput, StyleSheet, ActivityIndicator, Alert, Keyboard, InteractionManager } from "react-native";
import { usePathname } from "expo-router";
import Toast from "react-native-toast-message";
import useAuthStore from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";
import useHomeStore from "@/stores/homeStore";
import { api } from "@/services/api";
import { LoginCredentialsManager } from "@/services/storage";
import { ThemedView } from "./ThemedView";
import { ThemedText } from "./ThemedText";
import { StyledButton } from "./StyledButton";

const LoginModal = () => {
  const {
    isLoginModalVisible,
    isLoginModalManuallyOpened,
    loginModalInitialMode,
    hideLoginModal,
    checkLoginStatus,
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

  const handleLogin = async () => {
    const isLocalStorage = serverConfig?.StorageType === "localstorage";
    if (!password || (!isLocalStorage && !username)) {
      Toast.show({ type: "error", text1: "请输入用户名和密码" });
      return;
    }
    setIsLoading(true);
    try {
      await api.login(isLocalStorage ? undefined : username, password);
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
      Toast.show({
        type: "error",
        text1: "登录失败",
        text2: error instanceof Error ? error.message : "用户名或密码错误",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // 注册：不限制用户名和密码的字符数与格式，仅需非空
  const handleRegister = async () => {
    if (!username || !password) {
      Toast.show({ type: "error", text1: "请输入用户名和密码" });
      return;
    }
    setIsLoading(true);
    try {
      await api.register(username, password);
      await checkLoginStatus(apiBaseUrl);
      await refreshPlayRecords();

      // 注册成功即视为登录，保存凭据
      await LoginCredentialsManager.save({ username, password });

      Toast.show({ type: "success", text1: "注册成功", text2: "已自动登录" });
      hideLoginModal();
      setIsModalReady(false);
      Keyboard.dismiss();
    } catch (error) {
      Toast.show({
        type: "error",
        text1: "注册失败",
        text2: error instanceof Error ? error.message : "服务器拒绝了注册请求",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle navigation between inputs using returnKeyType
  const handleUsernameSubmit = () => {
    passwordInputRef.current?.focus();
  };

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
          <StyledButton
            text={isLoading ? "" : mode === "login" ? "登录" : "注册"}
            onPress={mode === "login" ? handleLogin : handleRegister}
            disabled={isLoading}
            style={styles.button}
            hasTVPreferredFocus={isLocalStorageServer}
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
});

export default LoginModal;
