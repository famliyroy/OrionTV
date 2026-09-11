import React from "react";
import { View, Text, StyleSheet, Modal, FlatList, Pressable } from "react-native";
import { StyledButton } from "./StyledButton";
import usePlayerStore from "@/stores/playerStore";

interface SpeedOption {
  rate: number;
  label: string;
}

const SPEED_OPTIONS: SpeedOption[] = [
  { rate: 0.5, label: "0.5x" },
  { rate: 0.75, label: "0.75x" },
  { rate: 1.0, label: "1x" },
  { rate: 1.25, label: "1.25x" },
  { rate: 1.5, label: "1.5x" },
  { rate: 1.75, label: "1.75x" },
  { rate: 2.0, label: "2x" },
];

export const SpeedSelectionModal: React.FC = () => {
  const { showSpeedModal, setShowSpeedModal, playbackRate, setPlaybackRate } = usePlayerStore();

  const onSelectSpeed = (rate: number) => {
    setPlaybackRate(rate);
    setShowSpeedModal(false);
  };

  const onClose = () => {
    setShowSpeedModal(false);
  };

  return (
    <Modal visible={showSpeedModal} transparent={true} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        {/* 点击面板外的屏幕区域即可关闭，返回播放页 */}
        <Pressable style={styles.backdrop} onPress={onClose} android_disableSound />
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>播放速度</Text>
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={16}>
              <Text style={styles.closeButtonText}>✕</Text>
            </Pressable>
          </View>
          <FlatList
            data={SPEED_OPTIONS}
            numColumns={3}
            contentContainerStyle={styles.speedList}
            keyExtractor={(item) => `speed-${item.rate}`}
            renderItem={({ item }) => (
              <StyledButton
                text={item.label}
                onPress={() => onSelectSpeed(item.rate)}
                isSelected={playbackRate === item.rate}
                hasTVPreferredFocus={playbackRate === item.rate}
                style={styles.speedItem}
                textStyle={styles.speedItemText}
              />
            )}
          />
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    backgroundColor: "transparent",
  },
  // 透明遮罩：占满右侧面板之外的区域，点击即关闭
  backdrop: {
    flex: 1,
  },
  modalContent: {
    width: 500,
    height: "100%",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    padding: 20,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    flex: 1,
    color: "white",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "bold",
    marginLeft: 24, // 与右侧关闭按钮对称，保持标题居中
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.15)",
  },
  closeButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
    lineHeight: 20,
  },
  speedList: {
    justifyContent: "flex-start",
  },
  speedItem: {
    paddingVertical: 10,
    margin: 4,
    marginLeft: 10,
    marginRight: 8,
    width: "30%",
  },
  speedItemText: {
    fontSize: 16,
  },
});