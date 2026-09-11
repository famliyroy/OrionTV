import React, { useEffect, useState } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import Toast from "react-native-toast-message";
import { ThemedText } from "@/components/ThemedText";
import { StyledButton } from "@/components/StyledButton";
import { SettingsSection } from "./SettingsSection";
import { api } from "@/services/api";
import { LoginCredentialsManager } from "@/services/storage";
import useAuthStore from "@/stores/authStore";
import { useSettingsStore } from "@/stores/settingsStore";
import Logger from "@/utils/Logger";

const logger = Logger.withTag("UserSection");

/**
 * 用户管理卡片：显示当前登录用户，支持登录/注册、退出登录、修改密码与修改用户名。
 * 登录/注册：用于首页未主动弹出登录框时，手动进入登录或注册；
 * 退出登录：清除登录态与本地凭据，随后直接弹出登录框，方便切换账号；
 * 修改密码依赖服务端 /api/change-password 接口；
 * 修改用户名依赖服务端 /api/change-username 接口（如服务端不支持会给出提示）。
 */
export const UserSection: React.FC = () => {
  const { isLoggedIn, showLoginModal, logout } = useAuthStore();
  const { serverConfig } = useSettingsStore();

  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isChangingUsername, setIsChangingUsername] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // localstorage 模式没有用户体系，不展示
  const isLocalStorage = serverConfig?.StorageType === "localstorage";

  useEffect(() => {
    const load = async () => {
      const credentials = await LoginCredentialsManager.get();
      if (credentials?.username) {
        setCurrentUsername(credentials.username);
      }
    };
    load();
  }, [isLoggedIn]);

  if (isLocalStorage) {
    return null;
  }

  const handleChangePassword = async () => {
    if (!newPassword) {
      Toast.show({ type: "error", text1: "请输入新密码" });
      return;
    }
    if (newPassword !== confirmPassword) {
      Toast.show({ type: "error", text1: "两次输入的密码不一致" });
      return;
    }
    setIsChangingPassword(true);
    try {
      await api.changePassword(newPassword);
      // 同步更新本地保存的凭据
      const credentials = await LoginCredentialsManager.get();
      await LoginCredentialsManager.save({
        username: credentials?.username || currentUsername,
        password: newPassword,
      });
      setNewPassword("");
      setConfirmPassword("");
      Toast.show({ type: "success", text1: "密码修改成功" });
    } catch (error) {
      logger.error("Failed to change password:", error);
      Toast.show({
        type: "error",
        text1: "密码修改失败",
        text2: error instanceof Error ? error.message : "请稍后重试",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleChangeUsername = async () => {
    if (!newUsername) {
      Toast.show({ type: "error", text1: "请输入新用户名" });
      return;
    }
    setIsChangingUsername(true);
    try {
      await api.changeUsername(newUsername);
      // 同步更新本地保存的凭据
      const credentials = await LoginCredentialsManager.get();
      await LoginCredentialsManager.save({
        username: newUsername,
        password: credentials?.password || "",
      });
      setCurrentUsername(newUsername);
      setNewUsername("");
      Toast.show({ type: "success", text1: "用户名修改成功" });
    } catch (error) {
      logger.error("Failed to change username:", error);
      Toast.show({
        type: "error",
        text1: "用户名修改失败",
        text2: "当前服务器可能不支持修改用户名",
      });
    } finally {
      setIsChangingUsername(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await logout();
      // 清除本地保存的凭据，避免下次登录自动填入上一个账号
      await LoginCredentialsManager.clear();
      setCurrentUsername("");
      setNewPassword("");
      setConfirmPassword("");
      setNewUsername("");
      Toast.show({ type: "success", text1: "已退出登录" });
      // 退出后直接打开登录弹窗，方便切换到其他账号
      showLoginModal("login");
    } catch (error) {
      logger.error("Failed to logout:", error);
      Toast.show({ type: "error", text1: "退出登录失败", text2: "请稍后重试" });
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <SettingsSection>
      <View style={styles.container}>
        <ThemedText style={styles.sectionTitle}>用户管理</ThemedText>

        <View style={styles.row}>
          <ThemedText style={styles.label}>当前账号</ThemedText>
          <ThemedText style={styles.value}>
            {isLoggedIn ? currentUsername || "已登录" : "未登录"}
          </ThemedText>
        </View>

        {/* 账号操作：未登录时可手动登录/注册；已登录时可退出登录 */}
        <View style={styles.group}>
          <ThemedText style={styles.groupTitle}>{isLoggedIn ? "账号操作" : "登录 / 注册"}</ThemedText>
          {isLoggedIn ? (
            <StyledButton
              text={isLoggingOut ? "退出中..." : "退出登录"}
              onPress={handleLogout}
              disabled={isLoggingOut}
              style={styles.actionButton}
            />
          ) : (
            <View style={styles.buttonRow}>
              <StyledButton
                text="登录"
                onPress={() => showLoginModal("login")}
                style={styles.actionButton}
              />
              <StyledButton
                text="注册账号"
                onPress={() => showLoginModal("register")}
                style={styles.actionButton}
              />
            </View>
          )}
        </View>

        {/* 以下两项仅在已登录时展示 */}
        {isLoggedIn && (
          <>
            <View style={styles.group}>
              <ThemedText style={styles.groupTitle}>修改密码</ThemedText>
              <TextInput
                style={styles.input}
                placeholder="新密码"
                placeholderTextColor="#888"
                secureTextEntry
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <TextInput
                style={styles.input}
                placeholder="确认新密码"
                placeholderTextColor="#888"
                secureTextEntry
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <StyledButton
                text={isChangingPassword ? "提交中..." : "修改密码"}
                onPress={handleChangePassword}
                disabled={isChangingPassword}
                variant="primary"
                style={styles.actionButton}
              />
            </View>
            <View style={styles.group}>
              <ThemedText style={styles.groupTitle}>修改用户名</ThemedText>
              <TextInput
                style={styles.input}
                placeholder="新用户名"
                placeholderTextColor="#888"
                autoCapitalize="none"
                autoCorrect={false}
                value={newUsername}
                onChangeText={setNewUsername}
              />
              <StyledButton
                text={isChangingUsername ? "提交中..." : "修改用户名"}
                onPress={handleChangeUsername}
                disabled={isChangingUsername}
                style={styles.actionButton}
              />
            </View>
          </>
        )}
      </View>
    </SettingsSection>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: "#888",
    marginRight: 12,
  },
  value: {
    fontSize: 14,
    fontWeight: "bold",
  },
  group: {
    marginBottom: 16,
  },
  groupTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 8,
    color: "#ccc",
  },
  input: {
    height: 46,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 15,
    backgroundColor: "#3a3a3c",
    color: "white",
    borderColor: "transparent",
    marginBottom: 10,
  },
  actionButton: {
    height: 44,
    alignSelf: "flex-start",
    minWidth: 140,
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
  },
});
