import cv2
RTSP_URL = "rtsp://admin:Kunika$0206@192.168.29.164:554/video/live?channel=1&subtype=0"
cap = cv2.VideoCapture(RTSP_URL)
if not cap.isOpened():
    print(f"FAILED to open RTSP stream: {RTSP_URL}")
else:
    print(f"SUCCESSfully opened RTSP stream: {RTSP_URL}")
    ret, frame = cap.read()
    if ret:
        print("Successfully read one frame.")
    else:
        print("FAILED to read frame.")
cap.release()
