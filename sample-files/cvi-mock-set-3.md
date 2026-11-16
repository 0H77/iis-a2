# CVI mock set 3

## Question 1
A network detects one object per image with output y = [Pc, x, y, w, h, C1, C2, C3], where x, y is the box centre, w, h its width and height, and C1/C2/C3 = car/pedestrian/truck. An image contains one pedestrian whose box has top-left corner (100, 60), width 80 and height 200 (pixels). Write y. What is Pc for an image with no object?

## Question 2
Apply the NMS procedure (discard Pc <= 0.6, keep the highest-scoring box, suppress boxes with IoU >= 0.5 against it, repeat) to these boxes (x1, y1, x2, y2; score): B1 (0,0,10,10; 0.9), B2 (1,1,11,11; 0.8), B3 (20,20,30,30; 0.7), B4 (5,0,15,10; 0.65), B5 (21,21,31,31; 0.4). Which boxes remain?

## Question 3
Pixel intensities 12, 15, 18, 80, 85, 90, 95 are clustered with k-means (K = 2), initial centres 20 and 70. Give the cluster assignments and the updated centres after one iteration. Has it converged?

## Question 4
Using the rigid transform x' = cos(t)x + sin(t)y, y' = -sin(t)x + cos(t)y followed by translation (tx, ty), map the point (4, 2) with t = 90 degrees and (tx, ty) = (3, -1).

## Question 5
Apply the Sobel kernels Sx = [-1 0 1; -2 0 2; -1 0 1] and Sy = [-1 -2 -1; 0 0 0; 1 2 1] to the centre of [10 20 40; 10 30 40; 20 30 50]. Give |gx|, |gy|, the gradient magnitude, and the approximation |gx| + |gy|.

## Question 6
Which colour spaces are commonly used in computer vision (RGB, HSV, HSL, BBC, HSX)? Explain what each letter means for the correct ones. What happens to an RGB image if the B channel is set to zero?

## Question 7
Explain the process of detecting lane lines with the Hough transform.

## Question 8
Compare a traditional feature-based image classification pipeline with a deep learning approach. Then describe how local binary patterns (LBP) extract features and what kind of features they capture.

## Question 9
Identify and explain three high-level computer vision tasks that build on low-level techniques.

## Question 10
Explain the role of spatial filtering, the difference between smoothing and sharpening (one example filter each), and why filtering is applied before edge detection.

## Question 11
Why is YOLO faster than Faster R-CNN?
A) It uses selective search
B) It skips the region proposal stage and predicts boxes and classes in a single pass over a grid
C) It uses a larger CNN
D) It processes each region separately

## Question 12
The key addition in Mask R-CNN compared with Faster R-CNN is:
A) A branch that predicts a pixel-level mask for each detected object
B) A grid of cells
C) Selective search
D) Optical flow

## Question 13
Otsu's method chooses the threshold that:
A) Equals the mean intensity
B) Minimises intra-class variance (equivalently maximises inter-class variance)
C) Maximises intra-class variance
D) Is the midpoint of the two histogram modes

## Question 14
Which similarity metric suits registering an MRI scan to a CT scan of the same patient?
A) Mean Squared Difference
B) Mutual Information
C) Euclidean distance between pixel values
D) Sum of Squared Differences

## Question 15
Which of these is NOT a reason vision is difficult?
A) File format
B) Occlusion
C) Illumination
D) Viewpoint
