import cv2
import numpy as np
import re
import sys
import os
from ultralytics import YOLO
import tkinter as tk
from tkinter import filedialog

# Import PaddleOCR
try:
    from paddleocr import PaddleOCR
except ImportError:
    print("Warning: PaddleOCR not installed. Please install using: pip install paddleocr paddlepaddle")
    PaddleOCR = None

def rectify_plate(image):
    """Attempts to find the license plate contour and apply perspective transform."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 50, 150)
    
    contours, _ = cv2.findContours(edged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    if not contours:
        return image
        
    # Sort contours by area, keep largest
    contours = sorted(contours, key=cv2.contourArea, reverse=True)[:5]
    
    plate_contour = None
    for c in contours:
        # approximate the contour
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        
        # if our approximated contour has four points, then we can assume that we have found our screen
        if len(approx) == 4:
            plate_contour = approx
            break
            
    if plate_contour is not None:
        # Apply perspective transform
        pts = plate_contour.reshape(4, 2)
        rect = np.zeros((4, 2), dtype="float32")
        
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]
        
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]
        
        (tl, tr, br, bl) = rect
        
        widthA = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
        widthB = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
        maxWidth = max(int(widthA), int(widthB))
        
        heightA = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
        heightB = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))
        maxHeight = max(int(heightA), int(heightB))
        
        dst = np.array([
            [0, 0],
            [maxWidth - 1, 0],
            [maxWidth - 1, maxHeight - 1],
            [0, maxHeight - 1]], dtype="float32")
            
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(image, M, (maxWidth, maxHeight))
        
        # Add 5% padding to avoid edge cutoff
        pad_h = int(maxHeight * 0.05)
        pad_w = int(maxWidth * 0.05)
        return cv2.copyMakeBorder(warped, pad_h, pad_h, pad_w, pad_w, cv2.BORDER_REPLICATE)
        
    # Fallback: if no 4-point contour, return the original but slightly padded
    return cv2.copyMakeBorder(image, 5, 5, 5, 5, cv2.BORDER_REPLICATE)

def preprocess_variants(image):
    """Generates multiple preprocessed variants of the plate image."""
    variants = {}
    
    # Base enhancements
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    # CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
    clahe_img = clahe.apply(gray)
    
    # Bilateral filter for noise removal keeping edges sharp
    bilateral = cv2.bilateralFilter(clahe_img, 11, 17, 17)
    
    # Variant 1: Grayscale + Bilateral
    variants['grayscale'] = bilateral
    
    # Variant 2: Adaptive Mean Thresholding
    thresh_mean = cv2.adaptiveThreshold(bilateral, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 11, 2)
    variants['adaptive_mean'] = thresh_mean
    
    # Variant 3: Adaptive Gaussian Thresholding
    thresh_gaussian = cv2.adaptiveThreshold(bilateral, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2)
    variants['adaptive_gaussian'] = thresh_gaussian
    
    # Variant 4: Otsu Thresholding
    _, thresh_otsu = cv2.threshold(bilateral, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants['otsu'] = thresh_otsu
    
    # Variant 5: Inverted Binary
    variants['inverted'] = cv2.bitwise_not(thresh_otsu)
    
    # Variant 6: Super Sharpened
    kernel_sharp = np.array([[-1,-1,-1], [-1,9,-1], [-1,-1,-1]])
    sharpened = cv2.filter2D(clahe_img, -1, kernel_sharp)
    variants['super_sharpened'] = sharpened
    
    # Variant 7: High Contrast Thresh
    _, high_contrast = cv2.threshold(clahe_img, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    variants['high_contrast'] = high_contrast
    
    # Variant 8: EV-Optimized (Green/Blue plates)
    # Extract channels; Blue and Red often have better contrast for white text on green
    b, g, r = cv2.split(image)
    ev_img = cv2.addWeighted(b, 0.5, r, 0.5, 0)
    ev_img = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8,8)).apply(ev_img)
    variants['ev_optimized'] = ev_img
    
    # Upscale all variants (3x for better OCR on small crops)
    upscaled_variants = {}
    for name, img in variants.items():
        upscaled_variants[name] = cv2.resize(img, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        
    return upscaled_variants

def postprocess_text(text):
    """Cleans up and corrects OCR text for Indian Plate format: LL NN LL NNNN."""
    # Remove "IND" if it was picked up separately on the left
    if text.startswith("IND"):
        text = text[3:]
        
    # Remove spaces and non-alphanumeric characters
    text = re.sub(r'[^A-Z0-9]', '', text.upper())
    
    # Standard length for Indian plates is 10 (or 9 in some older formats)
    # If we have 11 and it starts with I, it's likely "IND" + 10 chars
    if len(text) == 11 and text.startswith('I'):
        text = text[1:]
    
    mistakes = {
        'O': '0', '0': 'O',
        'I': '1', '1': 'I',
        'Z': '2', '2': 'Z',
        'S': '5', '5': 'S',
        'B': '8', '8': 'B',
        'A': '4', '4': 'A',
        'G': '6', '6': 'G',
        'H': 'W', # Common misread for WB plates
    }
    
    corrected = ""
    for i, char in enumerate(text):
        # Format: LL NN LL NNNN (10) or LL NN N NNNN (9) or LL NN NNNN (8)
        # Specifically for West Bengal (WB) misreads: WB often read as HB, NB, or MB
        if i == 0 and char in ['H', 'N', 'M']:
             # Look ahead: if second char is B, it's almost certainly WB
             if len(text) > 1 and text[1] == 'B':
                corrected += 'W'
                continue
             # Fallback for other cases where W is misread at the start
             if char in ['H', 'N']:
                corrected += 'W'
                continue
             
        if i in [0, 1, 4, 5]: # Letter positions
            if char.isdigit():
                corrected += mistakes.get(char, char)
            else:
                corrected += char
        elif i in [2, 3, 6, 7, 8, 9]: # Number positions
            if char.isalpha():
                corrected += mistakes.get(char, char)
            else:
                corrected += char
        else:
            corrected += char
            
    return corrected

def run_ocr_multiple(variants, ocr_reader):
    """Runs OCR on all variants and extracts text & confidence."""
    candidates = []
    
    if ocr_reader is None:
        return candidates
        
    for name, img in variants.items():
        # Ensure image is 3 channels if PaddleOCR expects it
        if len(img.shape) == 2:
            img_bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        else:
            img_bgr = img
            
        # Use predict() instead of ocr() for PaddleOCR 3.x compatibility
        results = ocr_reader.predict(img_bgr, use_textline_orientation=True)
        
        if not results:
            continue
            
        res_obj = results[0]
        texts = res_obj.get('rec_texts', [])
        scores = res_obj.get('rec_scores', [])
        boxes = res_obj.get('dt_polys', [])
        
        if not texts:
            continue
            
        # Merge all text blocks in this variant, sorted by X-coordinate (left to right)
        # dt_polys format: [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
        combined = []
        for i in range(len(texts)):
            # Use the X-coordinate of the top-left point of the box for sorting
            x_coord = boxes[i][0][0] if len(boxes) > i and len(boxes[i]) > 0 else 0
            combined.append((x_coord, texts[i], scores[i]))
            
        # Sort left-to-right
        combined.sort(key=lambda x: x[0])
        
        merged_text = "".join([c[1] for c in combined])
        avg_conf = sum([c[2] for c in combined]) / len(combined) if combined else 0
        
        candidates.append((merged_text, avg_conf))
            
    return candidates

def select_best_result(candidates):
    """Selects the best OCR result based on confidence and regex validation."""
    best_text = ""
    best_conf = 0.0
    all_preds = []
    
    valid_candidates = []
    
    # Regex pattern: Supports 8, 9, or 10 character Indian plates
    # LL NN LL NNNN (10) or LL NN N NNNN (9) or LL NN NNNN (8)
    patterns = [
        re.compile(r'^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$'), # 10 chars
        re.compile(r'^[A-Z]{2}[0-9]{2}[A-Z]{1}[0-9]{4}$'), # 9 chars
        re.compile(r'^[A-Z]{2}[0-9]{2}[0-9]{4}$'),         # 8 chars
    ]
    
    for text, conf in candidates:
        if conf < 0.4:
            continue
            
        cleaned_text = postprocess_text(text)
        all_preds.append({"raw": text, "cleaned": cleaned_text, "conf": conf})
        
        for p in patterns:
            if p.match(cleaned_text):
                # Prioritize longer matches (10 chars) by boosting confidence
                boost = 0.2 if len(cleaned_text) == 10 else 0.0
                valid_candidates.append((cleaned_text, conf + boost))
                break
            
    if valid_candidates:
        # Sort by confidence descending
        valid_candidates.sort(key=lambda x: x[1], reverse=True)
        best_text, best_conf = valid_candidates[0]
    elif all_preds:
        # Fallback: find the one closest to the pattern or just highest confidence
        all_preds.sort(key=lambda x: x['conf'], reverse=True)
        best_text = all_preds[0]['cleaned']
        best_conf = all_preds[0]['conf']
        
    return best_text, best_conf, all_preds

def process_image(frame, car_model, plate_model, reader, vehicle_classes):
    """Processes a single frame for vehicle and license plate detection."""
    # 1. Car / Vehicle Detection
    car_results = car_model(frame, classes=vehicle_classes, device='cpu', verbose=False)
    
    for result in car_results:
        boxes = result.boxes
        for box in boxes:
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            conf = float(box.conf[0])
            
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(frame, f"Vehicle {conf:.2f}", (x1, max(y1 - 10, 0)), 
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)

    # 2. License Plate Detection
    plate_results = plate_model(frame, device='cpu', verbose=False)

    for result in plate_results:
        boxes = result.boxes
        for box in boxes:
            px1, py1, px2, py2 = map(int, box.xyxy[0])
            
            h, w, _ = frame.shape
            px1, py1 = max(0, px1), max(0, py1)
            px2, py2 = min(w, px2), min(h, py2)

            cv2.rectangle(frame, (px1, py1), (px2, py2), (255, 0, 0), 2)
            
            plate_roi = frame[py1:py2, px1:px2]
            
            if plate_roi.shape[0] > 0 and plate_roi.shape[1] > 0 and reader is not None:
                # 3. High-Accuracy OCR Pipeline
                rectified_plate = rectify_plate(plate_roi)
                variants = preprocess_variants(rectified_plate)
                candidates = run_ocr_multiple(variants, reader)
                
                best_text, best_conf, all_preds = select_best_result(candidates)
                
                if best_text:
                    # Draw the recognized text above the license plate
                    cv2.putText(frame, f"{best_text} ({best_conf:.2f})", (px1, max(py1 - 10, 0)), 
                                cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
    return frame

def main():
    # Load the COCO-pretrained YOLOv8n model for car detection (running on CPU)
    print("Loading car detection model...")
    car_model = YOLO("yolov8n.pt")

    # Load custom license plate detection model (running on CPU)
    print("Loading license plate detection model...")
    plate_model = YOLO("licence_plate.pt")

    # Initialize PaddleOCR reader
    print("Initializing PaddleOCR...")
    if PaddleOCR is not None:
        # Disable enable_mkldnn=False to fix "ConvertPirAttribute2RuntimeAttribute not support" error on Windows
        reader = PaddleOCR(use_textline_orientation=True, lang='en', device='cpu', enable_mkldnn=False)
    else:
        reader = None
        print("PaddleOCR not available. Will skip OCR step.")

    # COCO class IDs: 2 is for 'car', 3 for 'motorcycle', 5 for 'bus', 7 for 'truck'
    vehicle_classes = [2, 3, 5, 7]

    print("\nSelect Mode:")
    print("1. Process an Image File (Upload)")
    print("2. Live Webcam Feed")
    
    choice = input("Enter your choice (1 or 2): ")

    if choice == '1':
        # File selection dialog
        root = tk.Tk()
        root.withdraw() # Hide the main tkinter window
        file_path = filedialog.askopenfilename(
            title="Select Image File",
            filetypes=[("Image Files", "*.jpg *.jpeg *.png *.bmp")]
        )
        
        if not file_path:
            print("No file selected. Exiting.")
            return

        frame = cv2.imread(file_path)
        if frame is None:
            print(f"Error: Could not read image from {file_path}")
            return

        print(f"Processing image: {file_path}")
        processed_frame = process_image(frame, car_model, plate_model, reader, vehicle_classes)
        
        cv2.imshow("Detection Result", processed_frame)
        print("Result displayed. Press any key to close.")
        cv2.waitKey(0)
        cv2.destroyAllWindows()

    else:
        # Initialize webcam capture
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            print("Error: Could not open the webcam.")
            return

        print("Starting webcam feed (Press 'q' to quit)...")

        while True:
            ret, frame = cap.read()
            if not ret:
                print("Error: failed to grab frame")
                break

            processed_frame = process_image(frame, car_model, plate_model, reader, vehicle_classes)
            cv2.imshow("Car and License Plate Detection", processed_frame)

            if cv2.waitKey(1) & 0xFF == ord('q'):
                break

        cap.release()
        cv2.destroyAllWindows()

if __name__ == "__main__":
    main()
