import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BarcodeScanner } from '@capacitor-mlkit/barcode-scanning';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css']
})
export class AppComponent {

  ipAddress: string = '';
  isIpSet: boolean = false;
  scanResult: string = '';

  setIp() {
    if (this.ipAddress.trim() !== '') {
      localStorage.setItem('serverIp', this.ipAddress);
      this.isIpSet = true;
    } else {
      alert('Please enter IP Address');
    }
  }

  async scanQR() {

    const permission = await BarcodeScanner.requestPermissions();

    if (permission.camera !== 'granted') {
      alert('Camera permission denied');
      return;
    }

    const result = await BarcodeScanner.scan();

    if (result.barcodes.length > 0) {
      this.scanResult = result.barcodes[0].rawValue!;
      console.log('Scanned:', this.scanResult);


    }

  }

  resetIp(){
    localStorage.removeItem('serverIp');
    this.isIpSet = false;
    this.ipAddress = '';
  }

}