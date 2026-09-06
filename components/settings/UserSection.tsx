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
 * 用户管理卡片：显示当前登录用户，支持修改密码与修改用户名。
 * 修改密码依赖服务端 /api/change-password 接口；
 * 修改用户名依赖服务端 /api/change-username 接口（如服务端不支持会给出提示）。
 */
export const UserSection: React.FC = () => {
  const { isLoggedIn } = useAuthStore();
  const { serverConfig } = useSettingsStore();

  const [currentUsername, setCurrentUsername] = useState<string>("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isChangingUsername, setIsChangingUsername] = useState(false);

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
            disabled={isChangingPassword || !isLoggedIn}
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
            disabled={isChangingUsername || !isLoggedIn}
            style={styles.actionButton}
          />
        </View>
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
});
