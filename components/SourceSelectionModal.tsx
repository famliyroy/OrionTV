import React from "react";
import { View, Text, StyleSheet, Modal, FlatList, Pressable } from "react-native";
import { StyledButton } from "./StyledButton";
import useDetailStore from "@/stores/detailStore";
import usePlayerStore from "@/stores/playerStore";
import Logger from '@/utils/Logger';

const logger = Logger.withTag('SourceSelectionModal');

export const SourceSelectionModal: React.FC = () => {
  const { showSourceModal, setShowSourceModal, loadVideo, currentEpisodeIndex, status } = usePlayerStore();
  const { searchResults, detail, setDetail } = useDetailStore();

  const onSelectSource = (index: number) => {
    logger.debug("onSelectSource", index, searchResults[index].source, detail?.source);
    if (searchResults[index].source !== detail?.source) {
      const newDetail = searchResults[index];
      setDetail(newDetail);
      
      // Reload the video with the new source, preserving current position
      const currentPosition = status?.isLoaded ? status.positionMillis : undefined;
      loadVideo({
        source: newDetail.source,
        id: newDetail.id.toString(),
        episodeIndex: currentEpisodeIndex,
        title: newDetail.title,
        position: currentPosition
      });
    }
    setShowSourceModal(false);
  };

  const onClose = () => {
    setShowSourceModal(false);
  };

  return (
    <Modal visible={showSourceModal} transparent={true} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalContainer}>
        {/* 点击面板外的屏幕区域即可关闭，返回播放页 */}
        <Pressable style={styles.backdrop} onPress={onClose} android_disableSound />
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>选择播放源</Text>
            <Pressable onPress={onClose} style={styles.closeButton} hitSlop={16}>
              <Text style={styles.closeButtonText}>✕</Text>
            </Pressable>
          </View>
          <FlatList
            data={searchResults}
            numColumns={3}
            contentContainerStyle={styles.sourceList}
            keyExtractor={(item, index) => `source-${item.source}-${index}`}
            renderItem={({ item, index }) => (
              <StyledButton
                text={item.source_name}
                onPress={() => onSelectSource(index)}
                isSelected={detail?.source === item.source}
                hasTVPreferredFocus={detail?.source === item.source}
                style={styles.sourceItem}
                textStyle={styles.sourceItemText}
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
    width: 600,
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
  sourceList: {
    justifyContent: "flex-start",
  },
  sourceItem: {
    paddingVertical: 2,
    margin: 4,
    marginLeft: 10,
    marginRight: 8,
    width: "30%",
  },
  sourceItemText: {
    fontSize: 14,
  },
});
